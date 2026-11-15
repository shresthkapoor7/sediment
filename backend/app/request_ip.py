from fastapi import Request


def get_request_ip(request: Request) -> str:
    """The caller's IP: the proxy-verified one when the middleware set it, else the socket peer."""
    verified_client_ip = getattr(request.state, "verified_client_ip", None)
    if isinstance(verified_client_ip, str) and verified_client_ip.strip():
        return verified_client_ip.strip()
    return request.client.host if request.client else "unknown"
