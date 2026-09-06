import sys
from app.database import SessionLocal
from app.models.project import Project
from app.models.user import User

db = SessionLocal()
try:
    print("Purging projects...")
    projects = db.query(Project).all()
    count = 0
    for p in projects:
        if "test" in p.name.lower() or "demo" in p.name.lower() or p.file_name == "sample.ifc":
            db.delete(p)
            count += 1
    db.commit()
    print(f"Purged {count} obsolete projects.")
finally:
    db.close()
