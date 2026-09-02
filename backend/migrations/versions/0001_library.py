"""Initial local library schema."""
from alembic import op
from backend.models import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    Base.metadata.create_all(op.get_bind())
    op.execute("CREATE VIRTUAL TABLE search_fts USING fts5(chunk_id UNINDEXED, title, body)")


def downgrade():
    raise RuntimeError("数据迁移不支持破坏性回退，请恢复备份。")
