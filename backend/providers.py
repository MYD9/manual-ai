"""Configurable OpenAI-compatible services. Never expose response bodies containing credentials."""
import hashlib
import json
import math
from urllib.parse import urlparse
import httpx
from backend.storage import read_secrets

DEEPSEEK_BASE = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-v4-flash"


def chat_options(base):
    # DeepSeek V4 defaults to thinking; extraction and interactive answers need a direct response.
    return {"thinking": {"type": "disabled"}} if urlparse(base).hostname == "api.deepseek.com" else {}


def chat_json(library, messages, *, max_tokens=2048):
    base, model, key = api_config(library, "chat")
    try:
        with httpx.Client(timeout=90, follow_redirects=False, trust_env=False) as client:
            response = client.post(endpoint(base, "chat/completions"), headers={"Authorization": "Bearer " + key}, json={
                "model": model, "messages": messages, "stream": False,
                "response_format": {"type": "json_object"}, "max_tokens": max_tokens,
                **chat_options(base),
            })
            check_response(response)
            value = response.json()["choices"][0]["message"]["content"]
            if not isinstance(value, str) or not value.strip():
                raise ValueError("AI 未返回识别结果，请重试或手动编辑")
            return json.loads(value)
    except httpx.TimeoutException:
        raise ValueError("AI 识别超时，原件已保存，可重试或手动编辑") from None
    except httpx.HTTPError:
        raise ValueError("无法连接 AI 服务，请检查网络和服务设置后重试") from None
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise ValueError("AI 返回格式不完整，请重试或手动编辑") from None


def endpoint(base, suffix):
    u = urlparse(base)
    if u.scheme not in ("https", "http") or not u.hostname or u.username or u.password or u.query or u.fragment:
        raise ValueError("服务地址必须是有效的 HTTP(S) API 地址，不可包含密码、查询参数或片段")
    if u.scheme == "http" and u.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("远程 AI 服务请使用 HTTPS")
    return base.rstrip("/") + "/" + suffix


def space_for(config):
    return hashlib.sha256((config.get("embedding_base", "") + "|" + config.get("embedding_model", "")).encode()).hexdigest()[:24]


def api_config(library, kind):
    config = library.settings()
    secrets = read_secrets(library)
    base, model = config.get(kind + "_base", ""), config.get(kind + "_model", "")
    key = secrets.get(kind + "_key", "")
    if not base or not model or not key:
        raise ValueError(("向量" if kind == "embedding" else "对话") + " API 尚未配置，请在设置页填写地址、模型和密钥")
    return base, model, key


def check_response(response):
    if response.status_code in (401, 403):
        raise ValueError("AI 服务拒绝访问，请检查密钥和模型权限")
    if response.status_code == 429:
        raise ValueError("AI 服务限流或额度不足，请稍后重试")
    if response.status_code >= 400:
        raise ValueError(f"AI 服务返回 HTTP {response.status_code}，请检查地址及模型配置")


def embedding_batch_size(config):
    # Bailian's v3/v4 limit applies to both public and workspace-compatible gateways.
    return 10 if config.get("embedding_model") in {"text-embedding-v3", "text-embedding-v4"} else 16


def embeddings(library, texts):
    if not texts:
        return []
    base, model, key = api_config(library, "embedding")
    batch_size = embedding_batch_size({"embedding_model": model})
    vectors = []
    dimensions = None
    try:
        with httpx.Client(timeout=90, follow_redirects=False, trust_env=False) as client:
            for start in range(0, len(texts), batch_size):
                batch = texts[start:start + batch_size]
                response = client.post(endpoint(base, "embeddings"), headers={"Authorization": "Bearer " + key}, json={
                    "model": model, "input": batch, "encoding_format": "float",
                })
                check_response(response)
                values = sorted(response.json()["data"], key=lambda r: r["index"])
                if len(values) != len(batch) or [r["index"] for r in values] != list(range(len(batch))):
                    raise ValueError("向量服务返回的条数或顺序无效")
                for row in values:
                    vector = row["embedding"]
                    if (not isinstance(vector, list) or not vector
                            or any(type(v) not in (int, float) or not math.isfinite(v) for v in vector)
                            or not any(vector)):
                        raise ValueError("向量 API 返回无效数据，请检查模型是否支持浮点向量")
                    if dimensions is not None and len(vector) != dimensions:
                        raise ValueError("向量 API 返回的维度不一致，请检查模型配置")
                    dimensions = len(vector)
                    vectors.append(vector)
            return vectors
    except httpx.TimeoutException:
        raise ValueError("AI 服务超时，资料已保留，可稍后重试") from None
    except httpx.HTTPError:
        raise ValueError("无法连接 AI 服务，请检查网络和服务地址") from None
    except (KeyError, TypeError, json.JSONDecodeError):
        raise ValueError("向量服务返回格式不兼容") from None


def chat_stream(library, messages):
    base, model, key = api_config(library, "chat")
    try:
        with httpx.Client(timeout=90, follow_redirects=False, trust_env=False) as client:
            with client.stream("POST", endpoint(base, "chat/completions"), headers={"Authorization": "Bearer " + key}, json={"model": model, "messages": messages, "stream": True, **chat_options(base)}) as response:
                check_response(response)
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    value = line[5:].strip()
                    if value == "[DONE]":
                        return
                    try:
                        delta = json.loads(value)["choices"][0].get("delta", {}).get("content")
                        if isinstance(delta, str):
                            yield delta
                    except (ValueError, KeyError, IndexError, TypeError):
                        continue
    except httpx.TimeoutException:
        raise ValueError("AI 服务响应超时，请稍后重试") from None
    except httpx.HTTPError:
        raise ValueError("AI 连接中断，请检查网络") from None
