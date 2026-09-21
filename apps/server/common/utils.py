class CommonUtils:
    @staticmethod
    def get_client_ip(request):
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            return x_forwarded_for.split(',')[0].strip()
        return request.META.get('REMOTE_ADDR') or '0.0.0.0'

    @staticmethod
    def parse_user_agent(user_agent):
        """Coarse device/os/browser from a User-Agent string, for login history only."""
        ua = (user_agent or '').lower()

        if 'electron' in ua:
            device_type = 'DESKTOP_APP'
        elif 'mobile' in ua or 'android' in ua or 'iphone' in ua:
            device_type = 'MOBILE'
        elif 'ipad' in ua or 'tablet' in ua:
            device_type = 'TABLET'
        elif ua:
            device_type = 'DESKTOP'
        else:
            device_type = None

        os_name = None
        for needle, name in (
            ('mac os x', 'macOS'), ('windows', 'Windows'), ('android', 'Android'),
            ('iphone', 'iOS'), ('ipad', 'iOS'), ('linux', 'Linux'),
        ):
            if needle in ua:
                os_name = name
                break

        browser = None
        for needle, name in (
            ('electron', 'Electron'), ('edg/', 'Edge'), ('chrome', 'Chrome'),
            ('firefox', 'Firefox'), ('safari', 'Safari'), ('node', 'Node'),
        ):
            if needle in ua:
                browser = name
                break

        return {'device_type': device_type, 'os': os_name, 'browser': browser}
