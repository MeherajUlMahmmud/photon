from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITestCase

from user_control.constants import MAX_FAILED_LOGIN_ATTEMPTS
from user_control.models import LoginAttemptModel, UserModel

EMAIL = 'ada@example.com'
PASSWORD = 'CorrectHorse1'


class AuthTestsBase(APITestCase):
    def setUp(self):
        cache.clear()

    def register(self, email=EMAIL, password=PASSWORD, **extra):
        return self.client.post('/api/auth/register/', {'email': email, 'password': password, **extra})

    def login(self, email=EMAIL, password=PASSWORD):
        return self.client.post('/api/auth/login/', {'email': email, 'password': password})

    def auth(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')


class RegisterTests(AuthTestsBase):
    def test_register_returns_user_and_tokens(self):
        self.assertEqual(self.client.get('/api/auth/has-users/').json()['data'], {'has_users': False})

        res = self.register(email='  Ada@Example.com ')
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual(body['status'], 'success')
        self.assertEqual(body['data']['user']['email'], EMAIL)
        self.assertIn('access', body['data']['tokens'])
        self.assertIn('refresh', body['data']['tokens'])
        self.assertEqual(self.client.get('/api/auth/has-users/').json()['data'], {'has_users': True})

    def test_register_validation(self):
        res = self.register(email='nope')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['message'], 'Enter a valid email address.')

        res = self.register(password='short')
        self.assertEqual(res.status_code, 400)
        self.assertIn('password', res.json()['errors'])

        res = self.register(password='alllowercase1')
        self.assertEqual(res.status_code, 400)

        self.register()
        res = self.register(email='ADA@example.com', password='AnotherPass1')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['message'], 'User with this email already exists.')

    def test_password_is_hashed(self):
        self.register()
        user = UserModel.objects.get(email=EMAIL)
        self.assertNotIn(PASSWORD, user.password)
        self.assertTrue(user.check_password(PASSWORD))


class LoginTests(AuthTestsBase):
    def setUp(self):
        super().setUp()
        self.register()
        self.client.credentials()

    def test_login_success_records_attempt(self):
        res = self.login(email='ADA@example.com')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['data']['user']['email'], EMAIL)

        user = UserModel.objects.get(email=EMAIL)
        self.assertEqual(user.login_count, 2)  # register + login
        self.assertTrue(LoginAttemptModel.objects.filter(user=user, success=True).exists())

    def test_wrong_password_and_unknown_email_look_the_same(self):
        wrong = self.login(password='WrongPass1')
        unknown = self.login(email='bob@example.com', password='WrongPass1')
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.json()['message'], unknown.json()['message'])
        self.assertEqual(LoginAttemptModel.objects.filter(success=False).count(), 2)

    def test_account_locks_after_failed_attempts(self):
        for _ in range(MAX_FAILED_LOGIN_ATTEMPTS):
            self.login(password='WrongPass1')
        user = UserModel.objects.get(email=EMAIL)
        self.assertTrue(user.is_locked)

        res = self.login()
        self.assertEqual(res.status_code, 401)
        self.assertIn('temporarily locked', res.json()['message'])

        user.lock_expiry = timezone.now() - timedelta(minutes=1)
        user.save(update_fields=['lock_expiry'])
        res = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertFalse(UserModel.objects.get(email=EMAIL).is_locked)

    def test_disabled_account_cannot_login(self):
        UserModel.objects.filter(email=EMAIL).update(is_active=False)
        res = self.login()
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['message'], 'This account has been disabled.')

    def test_login_rate_limited_by_ip(self):
        for _ in range(10):
            self.login(email=f'x{_}@example.com', password='WrongPass1')
        res = self.login()
        self.assertEqual(res.status_code, 429)


class TokenTests(AuthTestsBase):
    def test_me_requires_token(self):
        self.assertEqual(self.client.get('/api/user/me/').status_code, 401)
        self.auth('bogus')
        self.assertEqual(self.client.get('/api/user/me/').status_code, 401)

    def test_refresh_rotates_and_logout_blacklists(self):
        tokens = self.register().json()['data']['tokens']

        res = self.client.post('/api/auth/token/refresh/', {'refresh': tokens['refresh']})
        self.assertEqual(res.status_code, 200)
        new_tokens = res.json()['data']
        self.assertNotEqual(new_tokens['refresh'], tokens['refresh'])

        # Old refresh token is blacklisted after rotation.
        res = self.client.post('/api/auth/token/refresh/', {'refresh': tokens['refresh']})
        self.assertEqual(res.status_code, 401)

        self.auth(new_tokens['access'])
        res = self.client.post('/api/auth/logout/', {'refresh_token': new_tokens['refresh']})
        self.assertEqual(res.status_code, 200)
        res = self.client.post('/api/auth/token/refresh/', {'refresh': new_tokens['refresh']})
        self.assertEqual(res.status_code, 401)

    def test_password_change(self):
        tokens = self.register().json()['data']['tokens']
        self.auth(tokens['access'])

        res = self.client.post(
            '/api/auth/password-change/', {'old_password': 'Nope12345', 'new_password': 'NewPass123'},
        )
        self.assertEqual(res.status_code, 400)

        res = self.client.post(
            '/api/auth/password-change/', {'old_password': PASSWORD, 'new_password': 'NewPass123'},
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn('access', res.json()['data']['tokens'])

        # Old refresh token no longer works; the new password does.
        res = self.client.post('/api/auth/token/refresh/', {'refresh': tokens['refresh']})
        self.assertEqual(res.status_code, 401)
        self.client.credentials()
        self.assertEqual(self.login(password='NewPass123').status_code, 200)
        self.assertEqual(self.login().status_code, 401)


class CurrentUserTests(AuthTestsBase):
    def test_me_and_update(self):
        tokens = self.register().json()['data']['tokens']
        self.auth(tokens['access'])

        res = self.client.get('/api/user/me/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['data']['email'], EMAIL)

        res = self.client.patch('/api/user/me/update/', {'first_name': 'Ada', 'last_name': 'Lovelace'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['data']['first_name'], 'Ada')

        res = self.client.patch('/api/user/me/update/', {'first_name': 'Ada1'})
        self.assertEqual(res.status_code, 400)
