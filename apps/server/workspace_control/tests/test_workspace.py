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

    def test_archive_hides_from_active_and_reopen_restores(self):
        notes = self.open('/Users/ada/notes').json()['data']
        code = self.open('/Users/ada/code').json()['data']

        res = self.client.post(f"/api/workspace/{code['id']}/archive/")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNotNone(res.json()['data']['archived_at'])
        # The newest space is archived, so the active one falls back to the next.
        self.assertEqual(self.client.get('/api/workspace/active/').json()['data']['id'], notes['id'])
        # Still listed (with archived_at) so the client can show an Archived section.
        listed = {w['id']: w for w in self.client.get('/api/workspace/list/').json()['data']['data']}
        self.assertIsNotNone(listed[code['id']]['archived_at'])
        self.assertIsNone(listed[notes['id']]['archived_at'])

        res = self.client.post(f"/api/workspace/{code['id']}/unarchive/")
        self.assertIsNone(res.json()['data']['archived_at'])

        self.client.post(f"/api/workspace/{code['id']}/archive/")
        reopened = self.open('/Users/ada/code').json()['data']
        self.assertIsNone(reopened['archived_at'])

    def test_cannot_archive_someone_elses_space(self):
        notes = self.open('/Users/ada/notes').json()['data']
        self.client.force_authenticate(self.bob)
        self.assertEqual(self.client.post(f"/api/workspace/{notes['id']}/archive/").status_code, 404)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/workspace/list/').status_code, 401)
