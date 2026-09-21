from cryptography.fernet import Fernet
from django.conf import settings
from rest_framework.test import APITestCase

from user_control.models import UserModel, UserSecretModel
from user_control.services import SecretService

PASSWORD = 'CorrectHorse1'


class PerUserApiTestsBase(APITestCase):
    def setUp(self):
        self.alice = UserModel.objects.create_user('alice@example.com', PASSWORD)
        self.bob = UserModel.objects.create_user('bob@example.com', PASSWORD)

    def as_user(self, user):
        self.client.force_authenticate(user)


class UserSettingTests(PerUserApiTestsBase):
    def test_settings_are_per_user(self):
        self.as_user(self.alice)
        res = self.client.get('/api/setting/model_id/details/')
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json()['data']['value'])

        res = self.client.put('/api/setting/model_id/update/', {'value': 'claude-sonnet-5'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['data']['value'], 'claude-sonnet-5')

        res = self.client.put('/api/setting/model_id/update/', {'value': 'claude-opus-5'})
        self.assertEqual(res.json()['data']['value'], 'claude-opus-5')
        self.assertEqual(self.client.get('/api/setting/model_id/details/').json()['data']['value'], 'claude-opus-5')

        self.as_user(self.bob)
        self.assertIsNone(self.client.get('/api/setting/model_id/details/').json()['data']['value'])

    def test_invalid_key_rejected(self):
        self.as_user(self.alice)
        self.assertEqual(self.client.get('/api/setting/bad key!/details/').status_code, 400)

    def test_requires_auth(self):
        self.assertEqual(self.client.get('/api/setting/model_id/details/').status_code, 401)


class UserSecretTests(PerUserApiTestsBase):
    def test_secret_encrypted_and_per_user(self):
        self.as_user(self.alice)
        self.assertFalse(self.client.get('/api/secret/anthropic/details/').json()['data']['has_key'])

        res = self.client.put('/api/secret/anthropic/update/', {'api_key': 'sk-ant-secret'})
        self.assertEqual(res.status_code, 200, res.content)
        body = res.json()['data']
        self.assertTrue(body['has_key'])
        self.assertNotIn('sk-ant-secret', str(res.json()))

        secret = UserSecretModel.objects.get(user=self.alice, provider='anthropic')
        self.assertNotIn('sk-ant-secret', secret.ciphertext)
        self.assertEqual(
            Fernet(settings.FERNET_KEY.encode()).decrypt(secret.ciphertext.encode()), b'sk-ant-secret',
        )
        self.assertEqual(SecretService.get_api_key(self.alice, 'anthropic'), 'sk-ant-secret')

        self.as_user(self.bob)
        self.assertFalse(self.client.get('/api/secret/anthropic/details/').json()['data']['has_key'])
        self.assertIsNone(SecretService.get_api_key(self.bob, 'anthropic'))

    def test_delete_secret(self):
        self.as_user(self.alice)
        self.client.put('/api/secret/anthropic/update/', {'api_key': 'sk-ant-secret'})
        res = self.client.delete('/api/secret/anthropic/delete/')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()['data']['has_key'])
        self.assertFalse(UserSecretModel.objects.filter(user=self.alice).exists())

    def test_invalid_provider_and_blank_key(self):
        self.as_user(self.alice)
        self.assertEqual(self.client.get('/api/secret/Bad_Provider/details/').status_code, 400)
        self.assertEqual(self.client.put('/api/secret/anthropic/update/', {'api_key': ''}).status_code, 400)
