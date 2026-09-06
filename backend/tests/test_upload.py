import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_get_presigned_url_no_auth():
    response = client.post(
        "/api/v5/ifc/upload/presigned",
        json={"file_name": "test.ifc", "file_size_bytes": 1024}
    )
    # the tenant middleware will catch missing auth/tenant and return 400
    assert response.status_code in (400, 401)

def test_confirm_upload_no_auth():
    response = client.post(
        "/api/v5/ifc/upload/confirm",
        json={"object_key": "some_key", "declared_size": 1024}
    )
    assert response.status_code in (400, 401)
