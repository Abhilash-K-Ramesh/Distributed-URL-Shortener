from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_health():
    with patch("main.rate_limit_script", return_value=1):
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}