import os
from pathlib import Path

test_cache = Path(__file__).resolve().parent.parent / ".pytest_cache"
test_cache.mkdir(parents=True, exist_ok=True)
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{test_cache / 'test_forest_disease.db'}"
os.environ["UPLOAD_DIR"] = str(test_cache / "uploads")
os.environ["KINDWISE_API_KEY"] = ""
os.environ["OPENAI_API_KEY"] = ""
os.environ["DEEPSEEK_API_KEY"] = ""
