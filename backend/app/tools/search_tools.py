"""
app/tools/search_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WebSearch Agent Tool

支持两种后端（通过 SEARCH_ENGINE 配置切换）：
  - "serper"  → Serper.dev Google Search API（推荐，低延迟）
  - "google"  → Google Custom Search JSON API
  - "mock"    → 离线 Mock（开发/测试用，无需 API Key）

对外暴露：
  async web_search(query, num_results) → list[SearchResult]
  async web_search_summary(query, num_results) → dict      ← Agent 直接调用此函数
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import logging
import time
from typing import Annotated

import httpx
from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════════════════════════════════════

class SearchResult(BaseModel):
    """单条搜索结果"""
    rank:     int
    title:    str
    url:      str
    snippet:  str
    source:   str = ""   # 来源域名（如 pubmed.ncbi.nlm.nih.gov）


class WebSearchOutput(BaseModel):
    """web_search_summary 返回给 Agent 的完整结果"""
    query:        str
    engine:       str
    total_found:  int
    results:      list[SearchResult]
    elapsed_ms:   int
    error:        str | None = None


# ══════════════════════════════════════════════════════════════════════════════
# 内部：各搜索后端实现
# ══════════════════════════════════════════════════════════════════════════════

async def _search_via_serper(query: str, num_results: int) -> list[SearchResult]:
    """
    调用 Serper.dev API（GET https://google.serper.dev/search）
    文档：https://serper.dev/api-reference
    API Key 配置：SERPER_API_KEY
    """
    url = "https://google.serper.dev/search"
    headers = {
        "X-API-KEY":    settings.SERPER_API_KEY,
        "Content-Type": "application/json",
    }
    payload = {
        "q":   query,
        "num": num_results,
        "hl":  "zh-CN",
        "gl":  "cn",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    results = []
    for idx, item in enumerate(data.get("organic", [])[:num_results], start=1):
        results.append(SearchResult(
            rank    = idx,
            title   = item.get("title", ""),
            url     = item.get("link", ""),
            snippet = item.get("snippet", ""),
            source  = item.get("displayLink", ""),
        ))
    return results


async def _search_via_google_cse(query: str, num_results: int) -> list[SearchResult]:
    """
    调用 Google Custom Search JSON API
    文档：https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
    配置：GOOGLE_CSE_API_KEY 和 GOOGLE_CSE_ID
    """
    url = "https://www.googleapis.com/customsearch/v1"
    params = {
        "key": settings.GOOGLE_CSE_API_KEY,
        "cx":  settings.GOOGLE_CSE_ID,
        "q":   query,
        "num": min(num_results, 10),   # Google CSE 单次最多 10 条
        "lr":  "lang_zh-CN",
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()

    results = []
    for idx, item in enumerate(data.get("items", [])[:num_results], start=1):
        results.append(SearchResult(
            rank    = idx,
            title   = item.get("title", ""),
            url     = item.get("link", ""),
            snippet = item.get("snippet", ""),
            source  = item.get("displayLink", ""),
        ))
    return results


async def _search_mock(query: str, num_results: int) -> list[SearchResult]:
    """
    离线 Mock 搜索结果（仅用于开发和测试，不请求外部 API）。
    返回与肝移植营养相关的固定占位数据。
    """
    mock_data = [
        SearchResult(rank=1, title="肝移植术后营养支持专家共识（2023版）", url="https://pubmed.ncbi.nlm.nih.gov/mock1", snippet="肝移植术后早期营养支持对患者预后至关重要，推荐术后24小时内开始肠内营养……", source="pubmed.ncbi.nlm.nih.gov"),
        SearchResult(rank=2, title="ESPEN 肝病营养指南（2019）", url="https://www.espen.org/mock2", snippet="欧洲肠外肠内营养学会推荐肝移植患者蛋白质摄入量为1.2-1.5 g/kg/day……", source="espen.org"),
        SearchResult(rank=3, title="肝移植围手术期营养评估方法综述", url="https://www.chinagut.cn/mock3", snippet="常用营养评估工具包括 NRS2002、SGA、MUST，其中 NRS2002 灵敏度最高……", source="chinagut.cn"),
        SearchResult(rank=4, title="术后免疫营养素（谷氨酰胺）在肝移植中的应用", url="https://www.ncbi.nlm.nih.gov/mock4", snippet="谷氨酰胺补充可降低感染并发症率，建议剂量 0.3-0.5 g/kg/day……", source="ncbi.nlm.nih.gov"),
        SearchResult(rank=5, title="中国肝移植注册中心营养随访数据报告", url="https://www.cltr.org/mock5", snippet="全国肝移植中心随访数据显示，营养不良是影响术后5年生存率的独立危险因素……", source="cltr.org"),
    ]
    # 将 query 关键词注入 snippet，让结果看起来更相关
    for item in mock_data:
        item.snippet = f"[Mock·仅测试] {query} — {item.snippet}"

    return mock_data[:num_results]


# ══════════════════════════════════════════════════════════════════════════════
# 公开 API
# ══════════════════════════════════════════════════════════════════════════════

async def web_search(
    query:       str,
    num_results: int = 5,
) -> list[SearchResult]:
    """
    根据配置的 SEARCH_ENGINE 路由到对应后端，返回 SearchResult 列表。
    调用方无需感知底层引擎差异。
    """
    engine = settings.SEARCH_ENGINE.lower()
    logger.info(f"[WebSearch] engine={engine} query={query!r} num={num_results}")

    if engine == "serper":
        return await _search_via_serper(query, num_results)
    elif engine == "google":
        return await _search_via_google_cse(query, num_results)
    else:
        # "mock" 或未知值均走 Mock
        logger.warning(f"SEARCH_ENGINE='{engine}'，使用 Mock 模式")
        return await _search_mock(query, num_results)


async def web_search_summary(
    query: Annotated[str, Field(description="搜索关键词，支持中英文，建议精炼至 10 词以内")],
    num_results: Annotated[int, Field(default=5, ge=1, le=10, description="返回结果数量，1-10")] = 5,
) -> dict:
    """
    [Agent Tool] 执行 Web 搜索并返回结构化摘要。

    适用场景：
      - 查询最新营养指南、循证证据
      - 检索药物与营养素相互作用
      - 获取食物营养成分数据
      - 辅助生成营养方案时查阅参考文献

    Args:
        query:       搜索关键词
        num_results: 返回结果数量（默认 5，最多 10）

    Returns:
        WebSearchOutput 的 dict，结构为：
        {
          "query": str,
          "engine": str,
          "total_found": int,
          "results": [{"rank", "title", "url", "snippet", "source"}, ...],
          "elapsed_ms": int,
          "error": str | None
        }
    """
    t0 = time.monotonic()
    try:
        results = await web_search(query, num_results)
        elapsed = int((time.monotonic() - t0) * 1000)

        output = WebSearchOutput(
            query       = query,
            engine      = settings.SEARCH_ENGINE,
            total_found = len(results),
            results     = results,
            elapsed_ms  = elapsed,
        )
        logger.info(f"[WebSearch] 完成，返回 {len(results)} 条，耗时 {elapsed}ms")
        return output.model_dump()

    except httpx.HTTPStatusError as exc:
        elapsed = int((time.monotonic() - t0) * 1000)
        error_msg = f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
        logger.error(f"[WebSearch] 请求失败：{error_msg}")
        return WebSearchOutput(
            query=query, engine=settings.SEARCH_ENGINE,
            total_found=0, results=[], elapsed_ms=elapsed,
            error=error_msg,
        ).model_dump()

    except Exception as exc:
        elapsed = int((time.monotonic() - t0) * 1000)
        logger.exception(f"[WebSearch] 未知异常：{exc}")
        return WebSearchOutput(
            query=query, engine=settings.SEARCH_ENGINE,
            total_found=0, results=[], elapsed_ms=elapsed,
            error=str(exc),
        ).model_dump()


# ══════════════════════════════════════════════════════════════════════════════
# LangChain Tool 注册
# ══════════════════════════════════════════════════════════════════════════════

def get_search_tools() -> list:
    """返回可注册到 LangChain Agent 的搜索工具列表。"""
    try:
        from langchain.tools import StructuredTool
        from pydantic import BaseModel

        class WebSearchInput(BaseModel):
            query:       str = Field(description="搜索关键词，支持中英文")
            num_results: int = Field(default=5, ge=1, le=10, description="返回结果数（1-10）")

        return [
            StructuredTool.from_function(
                coroutine   = web_search_summary,
                name        = "web_search",
                description = (
                    "在互联网上搜索最新的医学文献、营养指南和循证证据。"
                    "当需要查询最新研究进展、药物相互作用、食物营养数据时使用此工具。"
                    "输入搜索关键词（中英文均可），返回前5条摘要。"
                ),
                args_schema = WebSearchInput,
            )
        ]
    except ImportError:
        logger.warning("langchain 未安装，跳过 WebSearch Tool 注册")
        return []
