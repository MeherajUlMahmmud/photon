from rest_framework.test import APITestCase

from user_control.models import UserModel


class WorkspaceTests(APITestCase):
    def setUp(self):
        self.alice = UserModel.objects.create_user('alice@example.com', 'CorrectHorse1')
        self.bob = UserModel.objects.create_user('bob@example.com', 'CorrectHorse1')
        self.client.force_authenticate(self.alice)

    def open(self, root_path):
        return self.client.post('/api/workspace/open/', {'root_path': root_path})

    def test_open_upserts_and_orders_by_last_opened(self):
        self.assertIsNone(self.client.get('/api/workspace/active/').json().get('data'))

        first = self.open('/Users/ada/notes').json()['data']
        self.assertEqual(first['name'], 'notes')
        self.open('/Users/ada/code/')
        again = self.open('/Users/ada/notes').json()['data']
        self.assertEqual(again['id'], first['id'])

        listed = self.client.get('/api/workspace/list/').json()['data']
        self.assertEqual(listed['total_records'], 2)
        self.assertEqual([w['name'] for w in listed['data']], ['notes', 'code'])
        self.assertEqual(self.client.get('/api/workspace/active/').json()['data']['id'], first['id'])

    def test_workspaces_are_per_user(self):
        self.open('/Users/ada/notes')
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.get('/api/workspace/list/').json()['data']['total_records'], 0)
        self.assertIsNone(self.client.get('/api/workspace/active/').json().get('data'))

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/workspace/list/').status_code, 401)
