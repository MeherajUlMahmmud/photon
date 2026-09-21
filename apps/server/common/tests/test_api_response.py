from rest_framework.test import APITestCase


class PingTests(APITestCase):
    def test_ping_uses_envelope(self):
        res = self.client.get('/api/ping/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'status': 'success', 'status_code': 200, 'message': 'pong'})

    def test_unknown_route_is_404(self):
        self.assertEqual(self.client.get('/api/nope/').status_code, 404)
