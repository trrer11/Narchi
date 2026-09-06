from app.api.ifc_routes import _estimation_cache_key
from app.models.project import Project
from app.schemas.ifc import ComputeRequest


def test_estimation_cache_key_is_deterministic_and_tenant_scoped():
    project = Project(id="project-1", tenant_id="tenant-a", user_id="user-1", name="P", file_name="p.ifc", file_path="x", bgf=1000, bri=3000)
    request = ComputeRequest(project_id="project-1", gebaeudeart="MFH", bauklasse="mittel")
    first = _estimation_cache_key("tenant-a", project, request)
    second = _estimation_cache_key("tenant-a", project, request)
    other_tenant = _estimation_cache_key("tenant-b", project, request)
    assert first == second
    assert first != other_tenant
    assert first.startswith("estimate:v5:")
