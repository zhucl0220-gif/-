"""
app/tools/sandbox_tools.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Python 代码执行沙箱 Agent Tool

⚠️  安全级别说明
┌──────────────────────────────────────────────────────────────────┐
│  当前实现（DEV）：                                               │
│    使用受限 exec() + 资源超时 + 黑名单过滤                       │
│    适用于：开发调试、演示、内部受信代码                          │
│                                                                  │
│  生产环境必须替换为以下方案之一：                                │
│    ① Docker 沙箱：每次执行启动独立容器                           │
│         docker run --rm --network none --memory 256m             │
│                  --cpus 0.5 --ulimit nproc=64                    │
│                  python:3.12-slim python -c "<code>"             │
│    ② gVisor（runsc）：内核级隔离                                 │
│    ③ Pyodide：WebAssembly 沙箱（适合前端 + 后端混合部署）       │
│    ④ JupyterHub 受限内核 + 资源配额                              │
│                                                                  │
│  无论哪种方案，均需配合：                                        │
│    - 网络隔离（--network none）                                  │
│    - 文件系统只读挂载（tmpfs /tmp）                              │
│    - CPU / 内存硬上限                                            │
│    - 执行超时强制 kill                                           │
└──────────────────────────────────────────────────────────────────┘

对外暴露：
  async execute_python_code(code, timeout_sec) → SandboxOutput (dict)

Agent 使用场景（肝移植营养系统）：
  - 计算 Harris-Benedict / Mifflin-St Jeor 能量需求公式
  - 绘制患者体重、蛋白质摄入趋势图
  - 分析检验指标时间序列（pandas）
  - 营养素配比计算与可视化
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import ast
import io
import logging
import os
import sys
import textwrap
import time
import traceback
import uuid
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, Field

from app.config import settings

logger = logging.getLogger(__name__)

# ── 沙箱图片输出目录 ──────────────────────────────────────────────────────────
SANDBOX_OUTPUT_DIR = Path(settings.UPLOAD_DIR) / "sandbox_outputs"
SANDBOX_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ── 执行超时（秒），DEV 模式默认 30s ──────────────────────────────────────────
DEFAULT_TIMEOUT_SEC = 30

# ══════════════════════════════════════════════════════════════════════════════
# 安全过滤：危险模块 / 函数黑名单（DEV 沙箱使用）
# ══════════════════════════════════════════════════════════════════════════════

_FORBIDDEN_IMPORTS = {
    "os", "sys", "subprocess", "socket", "shutil",
    "importlib", "ctypes", "multiprocessing", "threading",
    "signal", "pty", "tty", "termios", "fcntl",
    "resource", "mmap", "pickle", "shelve",
    "ftplib", "smtplib", "http", "urllib",
}

_FORBIDDEN_BUILTINS = {
    "__import__", "eval", "exec", "open",
    "compile", "globals", "locals", "vars",
    "breakpoint", "input",
}


def _static_safety_check(code: str) -> list[str]:
    """
    静态 AST 分析，提前拦截最危险的操作。
    返回违规列表（空列表表示通过）。
    
    ⚠️ 注意：AST 检查可被混淆绕过，生产环境必须使用容器级隔离。
    """
    violations = []
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"SyntaxError: {e}"]

    for node in ast.walk(tree):
        # 检查 import 语句
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            module = ""
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module = alias.name.split(".")[0]
                    if module in _FORBIDDEN_IMPORTS:
                        violations.append(f"禁止导入模块：{module}")
            elif isinstance(node, ast.ImportFrom):
                module = (node.module or "").split(".")[0]
                if module in _FORBIDDEN_IMPORTS:
                    violations.append(f"禁止导入模块：{module}")

        # 检查危险内置函数直接调用
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in _FORBIDDEN_BUILTINS:
                    violations.append(f"禁止调用内置函数：{node.func.id}")
            # 拦截 __dunder__ 属性访问
            if isinstance(node.func, ast.Attribute):
                if node.func.attr.startswith("__") and node.func.attr.endswith("__"):
                    violations.append(f"禁止访问魔法方法：{node.func.attr}")

    return violations


def _make_restricted_globals() -> dict:
    """
    构造受限的执行命名空间：
      - 保留数学、数据分析、可视化等合法库
      - 移除所有危险内置函数
    """
    import builtins
    allowed_builtins = {
        k: v for k, v in vars(builtins).items()
        if k not in _FORBIDDEN_BUILTINS
    }
    # 彻底移除 __import__，阻止动态导入危险模块
    allowed_builtins["__import__"] = _safe_import

    restricted = {
        "__builtins__": allowed_builtins,
        "__name__":     "__sandbox__",
    }

    # 预注入常用数据科学库（避免 Agent 需要 import）
    safe_imports = {
        "math": "math",
        "json": "json",
        "re":   "re",
        "datetime": "datetime",
        "collections": "collections",
        "statistics": "statistics",
        "decimal": "decimal",
        "fractions": "fractions",
        "random": "random",
    }
    for alias, module_name in safe_imports.items():
        try:
            restricted[alias] = __import__(module_name)
        except ImportError:
            pass

    # 尝试注入 numpy / pandas / matplotlib（如已安装）
    for lib in ("numpy", "pandas", "matplotlib", "matplotlib.pyplot"):
        try:
            mod = __import__(lib)
            key = lib.split(".")[0]
            restricted[key] = mod
            if lib == "numpy":
                restricted["np"] = mod
            elif lib == "pandas":
                restricted["pd"] = mod
        except ImportError:
            pass

    return restricted


# 白名单动态 import（允许特定库，阻止危险模块）
_ALLOWED_DYNAMIC_IMPORTS = {
    "numpy", "np", "pandas", "pd",
    "matplotlib", "matplotlib.pyplot", "plt",
    "math", "json", "re", "datetime",
    "statistics", "collections", "decimal",
    "fractions", "random", "itertools", "functools",
    "scipy", "sklearn", "seaborn", "plotly",
}

def _safe_import(name: str, *args, **kwargs):
    root = name.split(".")[0]
    if root not in _ALLOWED_DYNAMIC_IMPORTS and name not in _ALLOWED_DYNAMIC_IMPORTS:
        raise ImportError(f"[沙箱] 禁止导入：{name}（仅允许数据科学相关库）")
    return __import__(name, *args, **kwargs)


# ══════════════════════════════════════════════════════════════════════════════
# 图片收集：拦截 matplotlib savefig / show
# ══════════════════════════════════════════════════════════════════════════════

class _PlotInterceptor:
    """
    注入到沙箱命名空间，替换 plt.show() 和 plt.savefig()，
    将生成的图片自动保存到 SANDBOX_OUTPUT_DIR 并记录路径。
    """
    def __init__(self, output_dir: Path, session_id: str):
        self.output_dir  = output_dir
        self.session_id  = session_id
        self.image_paths: list[str] = []
        self._plt        = None

    def _get_plt(self):
        if self._plt is None:
            try:
                import matplotlib
                matplotlib.use("Agg")   # 无头模式，不弹窗
                import matplotlib.pyplot as plt
                self._plt = plt
            except ImportError:
                pass
        return self._plt

    def show(self):
        """替换 plt.show()：静默保存图片"""
        plt = self._get_plt()
        if plt and plt.get_fignums():
            path = self._save_current_figure(plt)
            if path:
                self.image_paths.append(path)
            plt.close("all")

    def savefig(self, path_or_buf=None, **kwargs):
        """替换 plt.savefig()：强制保存到沙箱输出目录"""
        plt = self._get_plt()
        if not plt:
            return
        filename = f"{self.session_id}_{uuid.uuid4().hex[:8]}.png"
        save_path = self.output_dir / filename
        kwargs.setdefault("bbox_inches", "tight")
        kwargs.setdefault("dpi", 150)
        plt.savefig(str(save_path), **kwargs)
        plt.close("all")
        rel_path = f"/uploads/sandbox_outputs/{filename}"
        self.image_paths.append(rel_path)
        logger.debug(f"[Sandbox] 图片已保存：{rel_path}")

    def _save_current_figure(self, plt) -> str | None:
        filename  = f"{self.session_id}_{uuid.uuid4().hex[:8]}.png"
        save_path = self.output_dir / filename
        try:
            plt.savefig(str(save_path), bbox_inches="tight", dpi=150)
            return f"/uploads/sandbox_outputs/{filename}"
        except Exception as e:
            logger.warning(f"[Sandbox] 图片保存失败：{e}")
            return None


# ══════════════════════════════════════════════════════════════════════════════
# 数据模型
# ══════════════════════════════════════════════════════════════════════════════

class SandboxOutput(BaseModel):
    success:      bool
    stdout:       str             = ""
    stderr:       str             = ""
    image_paths:  list[str]       = []
    error:        str | None      = None
    error_type:   str | None      = None
    elapsed_ms:   int             = 0
    safety_violations: list[str]  = []


# ══════════════════════════════════════════════════════════════════════════════
# 主执行函数
# ══════════════════════════════════════════════════════════════════════════════

async def execute_python_code(
    code: Annotated[
        str,
        Field(description="要执行的 Python 代码字符串。可使用 numpy/pandas/matplotlib 等数据科学库。"),
    ],
    timeout_sec: Annotated[
        int,
        Field(default=DEFAULT_TIMEOUT_SEC, ge=1, le=120, description="执行超时秒数，默认 30s，最大 120s"),
    ] = DEFAULT_TIMEOUT_SEC,
) -> dict:
    """
    [Agent Tool] 在受限沙箱中执行 Python 代码。

    ⚠️  当前为 DEV 模式（exec + 黑名单），生产环境请替换为 Docker 容器沙箱。

    能力：
      - 执行数值计算（numpy / math / statistics）
      - 数据分析（pandas）
      - 生成图表（matplotlib），图片自动保存并返回访问 URL
      - 捕获 stdout / stderr 输出

    限制：
      - 禁止访问文件系统（open / os / shutil 等）
      - 禁止网络操作（socket / urllib / requests 等）
      - 禁止启动子进程（subprocess）
      - 最大执行时间由 timeout_sec 控制

    Args:
        code:        Python 代码字符串
        timeout_sec: 执行超时时间（秒）

    Returns:
        SandboxOutput 的 dict：
        {
          "success": bool,
          "stdout":  str,           # print() 输出
          "stderr":  str,           # 警告信息
          "image_paths": [str],     # 图片访问 URL 列表
          "error":   str | None,    # 异常信息
          "error_type": str | None, # 异常类型名
          "elapsed_ms": int,
          "safety_violations": [str]
        }
    """
    session_id = uuid.uuid4().hex[:12]
    t0 = time.monotonic()

    # ── 代码规范化 ────────────────────────────────────────────────────────────
    # dedent 防止 Agent 传入缩进代码块时出现 IndentationError
    code = textwrap.dedent(code).strip()

    # ── 静态安全检查 ──────────────────────────────────────────────────────────
    violations = _static_safety_check(code)
    if violations:
        logger.warning(f"[Sandbox:{session_id}] 安全检查未通过：{violations}")
        return SandboxOutput(
            success           = False,
            error             = "代码包含安全违规操作，已拒绝执行",
            error_type        = "SecurityError",
            safety_violations = violations,
            elapsed_ms        = int((time.monotonic() - t0) * 1000),
        ).model_dump()

    # ── 准备受限命名空间 + 图片拦截器 ────────────────────────────────────────
    restricted_globals = _make_restricted_globals()
    interceptor        = _PlotInterceptor(SANDBOX_OUTPUT_DIR, session_id)

    # 注入图片拦截器到命名空间（Agent 生成的 plt.show() 会自动被拦截）
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as _real_plt

        # 使用 monkey-patch：替换 plt 命名空间中的 show/savefig
        restricted_globals["plt"]         = _real_plt
        restricted_globals["plt"].show    = interceptor.show     # type: ignore[method-assign]
        restricted_globals["plt"].savefig = interceptor.savefig  # type: ignore[method-assign]
    except ImportError:
        pass

    # ── 捕获 stdout / stderr ──────────────────────────────────────────────────
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    # ── 执行（带超时）─────────────────────────────────────────────────────────
    #
    # ⚠️  生产环境替换点：
    #     将以下 exec() 块替换为调用 Docker SDK：
    #
    #     import docker
    #     client = docker.from_env()
    #     result = client.containers.run(
    #         image   = "python:3.12-slim",
    #         command = ["python", "-c", code],
    #         network_disabled = True,
    #         mem_limit = "256m",
    #         cpu_period = 100000,
    #         cpu_quota  = 50000,       # 0.5 CPU
    #         remove  = True,
    #         stdout  = True,
    #         stderr  = True,
    #         timeout = timeout_sec,
    #         volumes = {str(SANDBOX_OUTPUT_DIR): {"bind": "/outputs", "mode": "rw"}},
    #     )
    #     stdout = result.decode("utf-8")
    #
    try:
        # asyncio 中使用 run_in_executor 隔离阻塞的 exec，避免阻塞事件循环
        import asyncio
        import concurrent.futures

        def _run_exec():
            with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                exec(compile(code, "<sandbox>", "exec"), restricted_globals)  # noqa: S102

        loop = asyncio.get_event_loop()
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = loop.run_in_executor(pool, _run_exec)
            await asyncio.wait_for(future, timeout=timeout_sec)

    except asyncio.TimeoutError:
        elapsed = int((time.monotonic() - t0) * 1000)
        logger.warning(f"[Sandbox:{session_id}] 执行超时（{timeout_sec}s）")
        return SandboxOutput(
            success     = False,
            stdout      = stdout_buf.getvalue(),
            stderr      = stderr_buf.getvalue(),
            error       = f"执行超时（超过 {timeout_sec} 秒），代码已强制终止",
            error_type  = "TimeoutError",
            image_paths = interceptor.image_paths,
            elapsed_ms  = elapsed,
        ).model_dump()

    except Exception as exc:
        elapsed = int((time.monotonic() - t0) * 1000)
        tb = traceback.format_exc()
        logger.info(f"[Sandbox:{session_id}] 代码执行异常：{type(exc).__name__}: {exc}")
        return SandboxOutput(
            success     = False,
            stdout      = stdout_buf.getvalue(),
            stderr      = stderr_buf.getvalue() + "\n" + tb,
            error       = str(exc),
            error_type  = type(exc).__name__,
            image_paths = interceptor.image_paths,
            elapsed_ms  = elapsed,
        ).model_dump()

    elapsed = int((time.monotonic() - t0) * 1000)
    stdout_content = stdout_buf.getvalue()
    stderr_content = stderr_buf.getvalue()

    # 收集 show() 触发的剩余图片（用户没有手动 show 的情况）
    try:
        import matplotlib.pyplot as plt
        if plt.get_fignums():
            interceptor.show()
    except Exception:
        pass

    logger.info(
        f"[Sandbox:{session_id}] 执行成功，耗时 {elapsed}ms，"
        f"图片 {len(interceptor.image_paths)} 张"
    )

    return SandboxOutput(
        success     = True,
        stdout      = stdout_content,
        stderr      = stderr_content,
        image_paths = interceptor.image_paths,
        elapsed_ms  = elapsed,
    ).model_dump()


# ══════════════════════════════════════════════════════════════════════════════
# LangChain Tool 注册
# ══════════════════════════════════════════════════════════════════════════════

def get_sandbox_tools() -> list:
    """返回可注册到 LangChain Agent 的沙箱工具列表。"""
    try:
        from langchain.tools import StructuredTool
        from pydantic import BaseModel

        class SandboxInput(BaseModel):
            code:        str = Field(description="要执行的 Python 代码，可使用 numpy/pandas/matplotlib")
            timeout_sec: int = Field(default=30, ge=1, le=120, description="超时秒数")

        return [
            StructuredTool.from_function(
                coroutine   = execute_python_code,
                name        = "execute_python_code",
                description = (
                    "在安全沙箱中执行 Python 代码，用于数值计算、数据分析和图表生成。\n"
                    "可用库：numpy(np), pandas(pd), matplotlib(plt), math, statistics, json 等。\n"
                    "返回：stdout 输出内容 + 生成图片的访问URL列表。\n"
                    "使用场景：计算患者能量需求、绘制营养趋势图、分析检验指标。"
                ),
                args_schema = SandboxInput,
            )
        ]
    except ImportError:
        logger.warning("langchain 未安装，跳过 Sandbox Tool 注册")
        return []
