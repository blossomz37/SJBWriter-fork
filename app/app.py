from flask import Flask, render_template, request, jsonify
from flask import Response
import os
import re
import json
import shutil
import tempfile
import requests
from datetime import datetime

# ===================== APP SETUP =====================
app = Flask(__name__)

APP_VERSION = "0.9.0"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ===================== PATH CONFIG =====================
# Global (tools)
GLOBAL_DIR = os.path.join(BASE_DIR, "..", "Global")
GLOBAL_STATE = os.path.join(GLOBAL_DIR, "state.json")

# Project
PROJECTS_DIR = os.path.join(BASE_DIR, "..", "Projects")
SAMPLE_PROJECT_STATE = os.path.join(
    PROJECTS_DIR, "sample-project", "state.json"
)
APP_STATE = os.path.join(GLOBAL_DIR, "app_state.json")


# ===================== STRUCTURE INIT =====================
def ensure_structure():
    # Global folders
    os.makedirs(os.path.join(GLOBAL_DIR, "prompts"), exist_ok=True)
    os.makedirs(os.path.join(GLOBAL_DIR, "system"), exist_ok=True)

    # Global state
    if not os.path.exists(GLOBAL_STATE):
        save_json(GLOBAL_STATE, {
            "prompts": [],
            "system": [],
            "last_opened_global": {}
        })

    project_dir = get_project_dir()
    project_meta_path = os.path.join(project_dir, "project.json")

    if not os.path.exists(project_meta_path):
        save_json(project_meta_path, {
            "id": get_current_project(),
            "title": get_current_project().replace("-", " ").title()
        })
    project_state = get_project_state()

    # Project folders
    os.makedirs(os.path.join(project_dir, "background"), exist_ok=True)
    os.makedirs(os.path.join(project_dir, "writing"), exist_ok=True)

    # Project state
    if not os.path.exists(project_state):
        if os.path.exists(SAMPLE_PROJECT_STATE):
            shutil.copy2(SAMPLE_PROJECT_STATE, project_state)
        else:
            raise FileNotFoundError(
                f"Sample project state not found: {SAMPLE_PROJECT_STATE}"
            )




# ===================== CORE HELPERS =====================


def load_json(path):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading JSON from {path}: {e}")
        return None


def save_json(path, data):
    # Write to a temp file in the same folder, then swap it in,
    # so a crash mid-save never leaves a half-written file
    folder = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(dir=folder, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp_path, 0o644)
        os.replace(tmp_path, path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


# ===================== SAFETY HELPERS =====================

SECTIONS = {"prompts", "system", "background", "writing"}


def is_safe_name(name):
    """One file or folder name: no path separators, no '..', no leading dot."""
    return (
        isinstance(name, str)
        and name.strip() != ""
        and "/" not in name
        and "\\" not in name
        and ".." not in name
        and not name.startswith(".")
    )


@app.before_request
def reject_unsafe_names():
    # Every route takes its section, file, and project names from JSON;
    # refuse anything that could point outside the data folders
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None

    if data.get("section") and data["section"] not in SECTIONS:
        return jsonify({"error": "Invalid section"}), 400

    for key in ("filename", "project", "current_project"):
        if data.get(key) and not is_safe_name(data[key]):
            return jsonify({"error": f"Invalid {key}"}), 400

    return None


def count_words(text):
    text = (text or "").strip()
    if not text:
        return 0
    return len(text.split())


# -------slug naming project files---------
import re

def slugify(title):
    title = title.lower()
    title = re.sub(r'[^a-z0-9]+', '-', title)
    return title.strip('-')


# ===================== APP STATE HELPERS =====================

def load_app_state():
    defaults = {
        "current_project": "default",
        "recent_projects": ["default"],
        "showWritingCounts": True,
        "showBackgroundCounts": True,
        "showPromptCounts": False,
        "showSystemCounts": False,
        "showFolderTotals": True,
        "editor_font": "Georgia",
        "editor_font_size": "16px"
    }

    if not os.path.exists(APP_STATE):
        save_json(APP_STATE, defaults)
        return defaults

    state = load_json(APP_STATE)

    changed = False

    for key, value in defaults.items():
        if key not in state:
            state[key] = value
            changed = True

    if changed:
        save_json(APP_STATE, state)

    return state


def write_app_state(state):
    save_json(APP_STATE, state)


def get_current_project():
    state = load_app_state()
    return state.get("current_project", "default")


def get_project_dir():
    project = get_current_project()
    if not is_safe_name(project):
        project = "default"
    return os.path.join(PROJECTS_DIR, project)


def get_project_state():
    return os.path.join(get_project_dir(), "state.json")



def set_global_last_opened(section, filename):
    state = load_json(GLOBAL_STATE)

    state["last_opened_global"] = {
        "project": get_current_project(),
        "section": section,
        "filename": filename
    }

    save_json(GLOBAL_STATE, state)


def set_project_last_opened(section, filename):
    state = load_json(get_project_state())

    state["last_opened_project"] = {
        "section": section,
        "filename": filename
    }

    save_json(get_project_state(), state)

# ===================== FILE & CONTENT HELPERS =====================

def get_state_file(section):
    if section in ["prompts", "system"]:
        return GLOBAL_STATE
    return get_project_state()

def get_base_path(section):
    if section in ["prompts", "system"]:
        return os.path.join(GLOBAL_DIR, section)
    return os.path.join(get_project_dir(), section)

def load_file_content(section, filename):
    if section not in SECTIONS or not is_safe_name(filename):
        return ""

    base_path = get_base_path(section)
    file_path = os.path.join(base_path, filename)

    if not os.path.exists(file_path):
        return ""

    data = load_json(file_path)
    if not data:
        return ""

    return data.get("content", "")


def add_word_counts(section, items):
    """Fill in every file's word count from its file, so the sidebar never shows (?)."""
    for item in items or []:
        if isinstance(item, dict) and item.get("type") == "folder":
            add_word_counts(section, item.get("items"))
        elif isinstance(item, dict) and item.get("filename"):
            item["wordCount"] = count_words(load_file_content(section, item["filename"]))


# ===================== VERSION HISTORY & TRASH =====================
# Each section folder keeps hidden .history/<file>/ and .trash/ folders.

HISTORY_MIN_INTERVAL = 5 * 60   # seconds between automatic versions of one file
HISTORY_KEEP = 50               # versions kept per file
VERSION_ID = re.compile(r"^\d{8}-\d{6}(-\d+)?$")   # timestamp, plus -2, -3… within one second


def version_time(version_id):
    return datetime.strptime(version_id[:15], "%Y%m%d-%H%M%S")


def history_dir(section, filename):
    stem = filename[:-5] if filename.endswith(".json") else filename
    return os.path.join(get_base_path(section), ".history", stem)


def list_versions(section, filename):
    folder = history_dir(section, filename)
    if not os.path.isdir(folder):
        return []
    return sorted(
        f[:-5] for f in os.listdir(folder)
        if f.endswith(".json") and VERSION_ID.match(f[:-5])
    )


def snapshot_file(section, filename, force=False):
    """Copy the file as it is now into its history before it changes."""
    src = os.path.join(get_base_path(section), filename)
    if not os.path.exists(src):
        return

    versions = list_versions(section, filename)
    folder = history_dir(section, filename)
    now = datetime.now()

    if versions:
        if not force and (now - version_time(versions[-1])).total_seconds() < HISTORY_MIN_INTERVAL:
            return

        # Nothing new to keep if the text matches the newest version
        newest = load_json(os.path.join(folder, f"{versions[-1]}.json")) or {}
        current = load_json(src) or {}
        if newest.get("content") == current.get("content"):
            return

    base_id = now.strftime("%Y%m%d-%H%M%S")
    version_id, n = base_id, 1
    while version_id in versions:
        n += 1
        version_id = f"{base_id}-{n}"

    os.makedirs(folder, exist_ok=True)
    shutil.copyfile(src, os.path.join(folder, f"{version_id}.json"))

    # Drop the oldest versions beyond the limit
    for old in versions[:max(0, len(versions) + 1 - HISTORY_KEEP)]:
        os.remove(os.path.join(folder, f"{old}.json"))


def move_to_trash(path, trash_root):
    """Move a file or folder into trash_root instead of deleting it."""
    os.makedirs(trash_root, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = os.path.basename(path)
    dest, n = os.path.join(trash_root, f"{stamp}-{name}"), 1
    while os.path.exists(dest):
        n += 1
        dest = os.path.join(trash_root, f"{stamp}-{n}-{name}")
    shutil.move(path, dest)
    return os.path.basename(dest)


TRASH_NAME = re.compile(r"^(\d{8}-\d{6})(?:-\d+)?-(.+)$")


def trash_index_path(trash_root):
    # Hidden, so trash listings skip it
    return os.path.join(trash_root, ".index.json")


def load_trash_index(trash_root):
    path = trash_index_path(trash_root)
    return (load_json(path) or {}) if os.path.exists(path) else {}


def remember_trash(trash_root, trash_name, info):
    """Note where a trashed file came from, so Restore can put it back."""
    index = load_trash_index(trash_root)
    index[trash_name] = info
    save_json(trash_index_path(trash_root), index)


def forget_trash(trash_root, trash_name):
    index = load_trash_index(trash_root)
    if index.pop(trash_name, None) is not None:
        save_json(trash_index_path(trash_root), index)


def parent_folder_id(items, filename, folder_id=None):
    """Id of the folder that holds filename; None at the top level."""
    for item in items:
        if isinstance(item, dict) and item.get("type") == "folder":
            found = parent_folder_id(item.get("items", []), filename, item.get("id"))
            if found is not False:
                return found
        elif (item.get("filename") if isinstance(item, dict) else item) == filename:
            return folder_id
    return False


def trash_roots():
    """Each trash folder the Trash window shows: (kind, section, path)."""
    roots = [("file", section, os.path.join(get_base_path(section), ".trash"))
             for section in ("writing", "background", "system", "prompts")]
    roots.append(("project", None, os.path.join(PROJECTS_DIR, ".trash")))
    return roots

def find_file_item(items, filename):

    for item in items:

        if (
            isinstance(item, dict)
            and item.get("type") == "file"
            and item.get("filename") == filename
        ):
            return item

        if (
            isinstance(item, dict)
            and item.get("type") == "folder"
        ):
            found = find_file_item(
                item.get("items", []),
                filename
            )

            if found:
                return found

    return None


def find_folder(items, folder_id):

    for item in items:

        if item.get("type") == "folder":

            if item.get("id") == folder_id:
                return item

            found = find_folder(
                item.get("items", []),
                folder_id
            )

            if found:
                return found

    return None

def remove_folder(items, folder_id):

    for i, item in enumerate(items):

        if (
            item.get("type") == "folder"
            and item.get("id") == folder_id
        ):
            return items.pop(i)

        if item.get("type") == "folder":

            removed = remove_folder(
                item.get("items", []),
                folder_id
            )

            if removed:
                return removed

    return None


def remove_file_from_tree(items, filename):
    result = []
    for item in items:
        if isinstance(item, dict) and item.get("type") == "folder":
            item["items"] = remove_file_from_tree(item.get("items", []), filename)
            result.append(item)
        elif isinstance(item, dict) and item.get("filename") == filename:
            continue  # drop it
        elif isinstance(item, str) and item == filename:
            continue  # drop it
        else:
            result.append(item)
    return result


def insert_into_tree(items, entry, folder_id=None, target_filename=None, position="after"):
    """Place entry inside a folder, next to a target file, or at the end."""
    if folder_id:
        folder = find_folder(items, folder_id)
        if folder:
            folder.setdefault("items", []).append(entry)
            return

    if target_filename:
        def place(level):
            for i, item in enumerate(level):
                if isinstance(item, dict) and item.get("type") == "folder":
                    if place(item.get("items", [])):
                        return True
                elif (item.get("filename") if isinstance(item, dict) else item) == target_filename:
                    level.insert(i if position == "before" else i + 1, entry)
                    return True
            return False

        if place(items):
            return

    items.append(entry)


# ===================== MODEL HELPERS =====================

MODEL_LIST_PATH = os.path.join(
    GLOBAL_DIR,
    "modelList.json"
)


def load_model_list():

    if not os.path.exists(MODEL_LIST_PATH):

        default_models = {
            "openrouter": [],
            "ollama": []
        }

        save_json(
            MODEL_LIST_PATH,
            default_models
        )

        return default_models

    return load_json(MODEL_LIST_PATH)


def save_model_list(data):
    save_json(MODEL_LIST_PATH, data)


# ===================== AI CLIENT =====================
REASONING_EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh", "max"}


def generation_options(settings):
    """Temperature (0-2) and reasoning effort from the client; None means "model default"."""
    temperature = settings.get("temperature")
    try:
        temperature = None if temperature is None else min(2.0, max(0.0, float(temperature)))
    except (TypeError, ValueError):
        temperature = None
    effort = settings.get("reasoning")
    return temperature, (effort if effort in REASONING_EFFORTS else None)


def per_token_price(value):
    """OpenRouter prices are strings in dollars per token; routers list -1 (unknown)."""
    try:
        price = float(value)
    except (TypeError, ValueError):
        return None
    return price if price >= 0 else None


def reply_limit(settings):
    """Max reply tokens from the client, capped at the model's own limit; None = no limit."""
    try:
        limit = int(settings.get("maxTokens") or 0)
    except (TypeError, ValueError):
        return None
    if limit < 1:
        return None
    info = (load_json(OPENROUTER_CATALOG) or {}).get("models", {}).get(settings.get("modelName")) \
        if os.path.exists(OPENROUTER_CATALOG) else None
    if info and info.get("max_out"):
        limit = min(limit, info["max_out"])
    return limit


def web_search_plugin(settings):
    """OpenRouter's web plugin when search is on: 1-10 results (10 is the per-search price cap)."""
    if not settings.get("webSearch"):
        return None
    try:
        max_results = int(settings.get("webMaxResults") or 5)
    except (TypeError, ValueError):
        max_results = 5
    return {"id": "web", "max_results": min(10, max(1, max_results))}

def load_document(section, filename):
    """(title, content) of a stored document, or None."""
    if section not in SECTIONS or not is_safe_name(filename):
        return None
    path = os.path.join(get_base_path(section), filename)
    if not os.path.exists(path):
        return None
    data = load_json(path) or {}
    return data.get("title") or filename[:-5], data.get("content", "")


def title_attr(text):
    return str(text or "").replace('"', "'").replace("\n", " ").strip()


def build_ai_request(data):
    """System files become the system message. Everything else goes in the user
    message, each part wrapped in a labelled tag so the model can tell notes,
    manuscript, the open document, and the instruction apart."""
    rules = []
    for filename in data.get("system", []):
        doc = load_document("system", filename)
        if doc and doc[1].strip():
            rules.append(doc[1].strip())

    blocks = []

    def add_group(tag, section):
        docs = []
        for filename in data.get(section, []):
            if not (isinstance(filename, str) and filename.endswith(".json")):
                continue
            doc = load_document(section, filename)
            if doc and doc[1].strip():
                docs.append(f'<document title="{title_attr(doc[0])}">\n{doc[1].strip()}\n</document>')
        if docs:
            blocks.append(f"<{tag}>\n" + "\n\n".join(docs) + f"\n</{tag}>")

    add_group("background", "background")
    add_group("writing", "writing")

    current = data.get("current")
    if not isinstance(current, dict):
        # Older pages send the editor text as the last writing item
        raw = [i for i in data.get("writing", []) if isinstance(i, str) and not i.endswith(".json")]
        current = {"title": "", "content": raw[-1] if raw else ""}
    if str(current.get("content") or "").strip():
        title = title_attr(current.get("title"))
        open_tag = f'<current_document title="{title}">' if title else "<current_document>"
        blocks.append(f"{open_tag}\n{current['content'].strip()}\n</current_document>")

    instruction = str(data.get("prompt") or "").strip()
    if instruction:
        blocks.append(f"<instruction>\n{instruction}\n</instruction>")

    return {"system": "\n\n".join(rules), "user": "\n\n".join(blocks)}


def call_openrouter(request_parts, settings):
    def get_api_key():
        config_path = os.path.join(GLOBAL_DIR, "config.json")

        if not os.path.exists(config_path):
            return None

        with open(config_path, "r") as f:
            config = json.load(f)

        return config.get("openrouter_api_key")

    api_key = get_api_key()

    model = settings.get("modelName")

    if not api_key:
        return {
            "error": "API key not set"
        }

    if not model:
        return {"error": "Missing model name"}


    url = "https://openrouter.ai/api/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    data = {
        "model": model,
        "messages": (
            [{"role": "system", "content": request_parts["system"]}] if request_parts["system"] else []
        ) + [{"role": "user", "content": request_parts["user"]}],
        "stream": True
    }

    # OpenRouter maps one reasoning setting onto each model family's own controls
    temperature, effort = generation_options(settings)
    if temperature is not None:
        data["temperature"] = temperature
    if effort:
        data["reasoning"] = {"effort": effort}
    limit = reply_limit(settings)
    if limit:
        data["max_tokens"] = limit

    # Web search (OpenRouter plugin; billed per search, even on free models)
    web = web_search_plugin(settings)
    if web:
        data["plugins"] = [web]


    try:
        response = requests.post(
            url,
            headers=headers,
            json=data,
            stream=True
        )

        print("\n=== OPENROUTER RESPONSE ===")
        print(response.status_code)
        print(response.headers.get("content-type"))
        print("==========================\n")

        if response.status_code != 200:
            if response.status_code == 400:
                return {
                    "error": "This model may be invalid or deprecated. Please verify it in Settings → Manage Models → select the model → Verify.",
                    "details": response.text
                }
            return {
                "error": f"OpenRouter error {response.status_code}",
                "details": response.text
            }

        def generate_stream():
            for line in response.iter_lines():

                if not line:
                    continue

                decoded = line.decode('utf-8')

                if not decoded.startswith("data: "):
                    continue

                payload = decoded[6:]

                if payload == "[DONE]":
                    break


                try:
                    chunk = json.loads(payload)

                    delta = (
                        chunk["choices"][0]
                        .get("delta", {})
                        .get("content", "")
                    )

                    if delta:
                        yield delta

                except Exception:
                    continue

        return generate_stream()


    except Exception as e:
        return {"error": str(e)}

def call_ollama(request_parts, settings):

    model = settings.get("modelName")

    if not model:
        return {"error": "Missing model name"}

    url = "http://localhost:11434/api/generate"

    data = {
        "model": model,
        "prompt": request_parts["user"],
        "stream": True
    }
    if request_parts["system"]:
        data["system"] = request_parts["system"]

    # Ollama: temperature goes in options; "think" turns reasoning on or off
    temperature, effort = generation_options(settings)
    if temperature is not None:
        data.setdefault("options", {})["temperature"] = temperature
    limit = reply_limit(settings)
    if limit:
        data.setdefault("options", {})["num_predict"] = limit
    if effort:
        data["think"] = effort != "none"

    try:

        response = requests.post(
            url,
            json=data,
            stream=True
        )

        if response.status_code != 200:
            return {
                "error": f"Ollama error {response.status_code}",
                "details": response.text
            }

        def generate_stream():

            for line in response.iter_lines():

                if not line:
                    continue

                try:
                    chunk = json.loads(
                        line.decode("utf-8")
                    )

                    text = chunk.get("response", "")

                    if text:
                        yield text

                    if chunk.get("done"):

                        print("\n=== OLLAMA STATS ===")
                        print(f"Model: {chunk.get('model')}")
                        print(f"Done Reason: {chunk.get('done_reason')}")
                        print(f"Prompt Tokens: {chunk.get('prompt_eval_count')}")
                        print(f"Output Tokens: {chunk.get('eval_count')}")
                        print(f"Load Duration: {chunk.get('load_duration')}")
                        print(f"Total Duration: {chunk.get('total_duration')}")
                        print("====================\n")
                        break

                except Exception:
                    continue

        return generate_stream()

    except Exception as e:
        return {"error": str(e)}

# ===================== ROUTES =====================
# ---------- ROUTES (ALL ABOVE app.run) ----------

@app.route("/")
def route_home():
    return render_template("index.html", app_version=APP_VERSION)


@app.route('/save_api_key', methods=['POST'])
def api_save_api_key():
    data = request.json
    api_key = data.get("apiKey")

    if not api_key:
        return jsonify({"error": "Missing API key"}), 400

    config_path = os.path.join(GLOBAL_DIR, "config.json")

    # Load existing config if exists
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            config = json.load(f)
    else:
        config = {}

    config["openrouter_api_key"] = api_key

    save_json(config_path, config)

    return jsonify({"status": "saved"})


@app.route('/load', methods=['GET'])
def api_load_all():
    ensure_structure()

    global_state = load_json(GLOBAL_STATE)
    project_state = load_json(get_project_state())

    # Counts come from the files themselves, so files never saved here still have one
    for section in ("prompts", "system"):
        add_word_counts(section, global_state.get(section))
    for section in ("background", "writing"):
        add_word_counts(section, project_state.get(section))

    return jsonify({
        "global": global_state,
        "project": project_state,
        "app_state": load_app_state()
    })


@app.route('/generate', methods=['POST'])
def api_generate():
    data = request.json
    request_parts = build_ai_request(data)

    client_settings = data.get("settings", {})

    model_source = client_settings.get("modelSource", "openrouter")
    model_name = client_settings.get("modelName")

    model_settings = {
        "modelName": model_name,
        "temperature": client_settings.get("temperature"),
        "reasoning": client_settings.get("reasoning"),
        "webSearch": client_settings.get("webSearch"),
        "webMaxResults": client_settings.get("webMaxResults"),
        "maxTokens": client_settings.get("maxTokens")
    }

    if model_source == "openrouter":

        result = call_openrouter(request_parts, model_settings)

    elif model_source == "ollama":

        result = call_ollama(request_parts, model_settings)

    else:

        result = {
            "error": f"Unknown model source: {model_source}"
        }

    if isinstance(result, dict) and result.get("error"):
        return jsonify(result), 400

    return Response(
        result,
        mimetype='text/plain'
    )




@app.route('/preview_request', methods=['POST'])
def api_preview_request():
    """The exact system and user messages Generate would send."""
    return jsonify(build_ai_request(request.json or {}))


@app.route('/models', methods=['GET'])
def api_get_models():
    model_file = os.path.join(GLOBAL_DIR, "modelList.json")
    order_file = os.path.join(GLOBAL_DIR, "ollama_order.json")

    if not os.path.exists(model_file):
        return jsonify({"openrouter": [], "ollama": []})

    with open(model_file, "r") as f:
        data = json.load(f)

    saved_ollama_models = data.setdefault("ollama", [])
    saved_by_id = {
        model["id"]: model
        for model in saved_ollama_models
        if model.get("id")
    }

    available_ollama_models = []

    try:
        response = requests.get(
            "http://localhost:11434/api/tags",
            timeout=5
        )
        response.raise_for_status()
        ollama_data = response.json()

        catalog_changed = False

        for discovered in ollama_data.get("models", []):
            model_id = discovered.get("name")

            if not model_id:
                continue

            model = saved_by_id.get(model_id)

            if model is None:
                model = {
                    "id": model_id,
                    "name": model_id,
                    "source": "ollama",
                    "context": (
                        discovered.get("details", {})
                        .get("context_length", 0)
                    ),
                    "description": "",
                    "labels": []
                }

                saved_ollama_models.append(model)
                saved_by_id[model_id] = model
                catalog_changed = True

            available_ollama_models.append(model)

        if catalog_changed:
            save_model_list(data)

        catalog_ids = [
            model["id"]
            for model in saved_ollama_models
            if model.get("id")
        ]
        available_ids = [
            model["id"]
            for model in available_ollama_models
        ]

        order_changed = False

        if os.path.exists(order_file):
            with open(order_file, "r") as f:
                saved_order = json.load(f)

            if not isinstance(saved_order, list):
                saved_order = []
                order_changed = True

            # Newly installed models go to the top of this local list.
            new_installed_ids = [
                model_id
                for model_id in available_ids
                if model_id not in saved_order
            ]

            if new_installed_ids:
                saved_order = new_installed_ids + saved_order
                order_changed = True

            # Keep catalog entries so reinstalling a model can restore
            # its previous position.
            for model_id in catalog_ids:
                if model_id not in saved_order:
                    saved_order.append(model_id)
                    order_changed = True

        else:
            # On first initialization, use Ollama's current inventory
            # order, followed by any known models that are not installed.
            saved_order = available_ids + [
                model_id
                for model_id in catalog_ids
                if model_id not in available_ids
            ]
            order_changed = True

        if order_changed:
            save_json(order_file, saved_order)

        order_positions = {
            model_id: index
            for index, model_id in enumerate(saved_order)
        }

        available_ollama_models.sort(
            key=lambda model: order_positions.get(
                model["id"],
                len(order_positions)
            )
        )

    except Exception as e:
        print(f"Ollama discovery failed: {e}")

    data["ollama"] = available_ollama_models
    return jsonify(data)



@app.route('/add_model', methods=['POST'])
def api_add_model():

    data = request.json

    model_id = data.get("id", "").strip()
    name = data.get("name", "").strip()
    source = data.get("source", "openrouter").strip()
    context = data.get("context", 0)
    description = data.get("description", "").strip()
    labels = data.get("labels", [])

    if not model_id or not name:
        return jsonify({
            "error": "Missing required fields"
        }), 400

    models = load_model_list()

    source_models = models.get(source, [])

    # Prevent duplicate IDs
    for model in source_models:

        if model.get("id") == model_id:

            return jsonify({
                "error": "Model already exists"
            }), 400

    source_models.append({
        "id": model_id,
        "name": name,
        "source": source,
        "context": context,
        "description": description,
        "labels": labels
    })

    models[source] = source_models

    save_model_list(models)

    return jsonify({
        "status": "created"
    })


@app.route('/update_model', methods=['POST'])
def api_update_model():
    data = request.json
    model_id = data.get("id")
    if not model_id:
        return jsonify({
            "error": "Missing model ID"
        }), 400

    models = load_model_list()
    target = None

    for source_models in models.values():

        target = next(
            (
                m for m in source_models
                if m.get("id") == model_id
            ),
            None
        )

        if target:
            break

    if not target:
        return jsonify({
            "error": "Model not found"
        }), 404

    target["name"] = data.get("name", "")
    target["source"] = data.get(
        "source",
        "openrouter"
    )
    target["context"] = data.get(
        "context",
        ""
    )
    target["description"] = data.get(
        "description",
        ""
    )
    target["labels"] = data.get(
        "labels",
        []
    )
    save_model_list(models)
    return jsonify({
        "status": "success"
    })

@app.route('/delete_model', methods=['POST'])
def api_delete_model():

    data = request.json

    model_id = data.get("id")

    if not model_id:
        return jsonify({
            "error": "Missing model ID"
        }), 400

    models = load_model_list()

    for source, source_models in models.items():

        updated = [
            m for m in source_models
            if m.get("id") != model_id
        ]

        models[source] = updated

    save_model_list(models)

    return jsonify({
        "status": "deleted"
    })


@app.route('/move_model', methods=['POST'])
def api_move_model():
    data = request.json or {}

    model_id = data.get("id")
    direction = data.get("direction")

    if model_id is None or direction is None:
        return jsonify({"error": "Missing data"}), 400

    try:
        direction = int(direction)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid direction"}), 400

    if direction not in (-1, 1):
        return jsonify({"error": "Invalid direction"}), 400

    models = load_model_list()
    target_source = None

    for source, source_models in models.items():
        if any(
            model.get("id") == model_id
            for model in source_models
        ):
            target_source = source
            break

    if target_source is None:
        return jsonify({"error": "Model not found"}), 404

    if target_source == "ollama":
        order_file = os.path.join(
            GLOBAL_DIR,
            "ollama_order.json"
        )

        try:
            response = requests.get(
                "http://localhost:11434/api/tags",
                timeout=5
            )
            response.raise_for_status()

            installed_ids = [
                model.get("name")
                for model in response.json().get("models", [])
                if model.get("name")
            ]

        except Exception as e:
            print(f"Ollama discovery failed: {e}")
            return jsonify({
                "error": "Ollama is unavailable"
            }), 503

        if model_id not in installed_ids:
            return jsonify({"error": "Model not installed"}), 404

        if os.path.exists(order_file):
            with open(order_file, "r") as f:
                saved_order = json.load(f)
        else:
            saved_order = [
                model.get("id")
                for model in models.get("ollama", [])
                if model.get("id")
            ]

        # Retain saved positions for models that are currently uninstalled.
        for saved_model in models.get("ollama", []):
            saved_id = saved_model.get("id")
            if saved_id and saved_id not in saved_order:
                saved_order.append(saved_id)

        # Newly installed models appear at the top of the local order.
        new_ids = [
            model_id
            for model_id in installed_ids
            if model_id not in saved_order
        ]
        saved_order = new_ids + saved_order

        visible_order = [
            model_id
            for model_id in saved_order
            if model_id in installed_ids
        ]

        index = visible_order.index(model_id)
        new_index = index + direction

        if new_index < 0 or new_index >= len(visible_order):
            return jsonify({"error": "Invalid move"}), 400

        other_id = visible_order[new_index]
        first_position = saved_order.index(model_id)
        second_position = saved_order.index(other_id)

        saved_order[first_position], saved_order[second_position] = (
            saved_order[second_position],
            saved_order[first_position]
        )

        save_json(order_file, saved_order)

    else:
        existing = models.get(target_source, [])

        index = next(
            (
                i for i, model in enumerate(existing)
                if model.get("id") == model_id
            ),
            None
        )

        if index is None:
            return jsonify({"error": "Model not found"}), 404

        new_index = index + direction

        if new_index < 0 or new_index >= len(existing):
            return jsonify({"error": "Invalid move"}), 400

        existing[index], existing[new_index] = (
            existing[new_index],
            existing[index]
        )

        save_model_list(models)

    return jsonify({"status": "moved"})


@app.route('/api_key_status', methods=['GET'])
def api_key_status():
    config_path = os.path.join(GLOBAL_DIR, "config.json")

    if not os.path.exists(config_path):
        return jsonify({"status": "missing"})

    with open(config_path, "r") as f:
        config = json.load(f)

    if config.get("openrouter_api_key"):
        return jsonify({"status": "saved"})
    else:
        return jsonify({"status": "missing"})


@app.route('/opened_file', methods=['POST'])
def api_opened_file():
    ensure_structure()

    data = request.json

    section = data.get("section")
    filename = data.get("filename")

    if not section or not filename:
        return jsonify({"error": "Missing data"}), 400

    # Always update global memory
    set_global_last_opened(section, filename)

    # Only project sections update project memory
    if section in ["background", "writing"]:
        set_project_last_opened(section, filename)

    return jsonify({"status": "updated"})


@app.route('/save_order', methods=['POST'])
def api_save_order():
    ensure_structure()

    data = request.json

    section = data.get("section")
    items = data.get("items")

    if not section or items is None:
        return jsonify({"error": "Missing data"}), 400

    state_file = get_state_file(section)

    state = load_json(state_file)

    state[section] = items

    save_json(state_file, state)

    return jsonify({"status": "saved"})


@app.route('/projects', methods=['GET'])
def api_get_projects():

    os.makedirs(PROJECTS_DIR, exist_ok=True)

    projects = []

    for folder in os.listdir(PROJECTS_DIR):

        project_dir = os.path.join(PROJECTS_DIR, folder)

        # Skip hidden folders such as .trash
        if not os.path.isdir(project_dir) or folder.startswith("."):
            continue

        meta_path = os.path.join(project_dir, "project.json")

        if os.path.exists(meta_path):
            meta = load_json(meta_path)

            projects.append({
                "id": meta.get("id", folder),
                "title": meta.get("title", folder)
            })

        else:
            projects.append({
                "id": folder,
                "title": folder.replace("-", " ").title()
            })

    projects.sort(key=lambda p: p["title"].lower())

    app_state = load_app_state()

    return jsonify({
        "projects": projects,
        "recent": app_state.get("recent_projects", []),
        "current": app_state.get("current_project", "default")
    })


@app.route('/create_project', methods=['POST'])
def api_create_project():

    data = request.json

    name = data.get("name", "").strip()

    if not name:
        return jsonify({"error": "Missing project name"}), 400

    project_slug = slugify(name)

    project_dir = os.path.join(PROJECTS_DIR, project_slug)

    if os.path.exists(project_dir):
        return jsonify({"error": "Project already exists"}), 400

    # Create folders
    os.makedirs(os.path.join(project_dir, "background"))
    os.makedirs(os.path.join(project_dir, "writing"))

    # Create project metadata
    save_json(
        os.path.join(project_dir, "project.json"),
        {
            "id": project_slug,
            "title": name
        }
    )

    # Create state
    save_json(
        os.path.join(project_dir, "state.json"),
        {
            "background": [],
            "writing": [],
            "last_opened_project": {}
        }
    )

    # Update app state
    app_state = load_app_state()

    app_state["current_project"] = project_slug

    recent = app_state.get("recent_projects", [])

    if project_slug in recent:
        recent.remove(project_slug)

    recent.insert(0, project_slug)

    app_state["recent_projects"] = recent[:5]

    write_app_state(app_state)

    return jsonify({
        "status": "created",
        "project": project_slug
    })

@app.route('/rename_project', methods=['POST'])
def api_rename_project():

    data = request.json

    old_id = data.get("project")
    new_name = data.get("name", "").strip()

    if not old_id or not new_name:
        return jsonify({"error": "Missing data"}), 400

    new_slug = slugify(new_name)

    old_dir = os.path.join(PROJECTS_DIR, old_id)
    new_dir = os.path.join(PROJECTS_DIR, new_slug)

    if not os.path.exists(old_dir):
        return jsonify({"error": "Project not found"}), 404

    if os.path.exists(new_dir):
        return jsonify({"error": "Target project exists"}), 400

    # Rename folder
    os.rename(old_dir, new_dir)

    # Update metadata
    meta_path = os.path.join(new_dir, "project.json")

    meta = load_json(meta_path)

    meta["id"] = new_slug
    meta["title"] = new_name

    save_json(meta_path, meta)

    # Update app state
    app_state = load_app_state()

    if app_state.get("current_project") == old_id:
        app_state["current_project"] = new_slug

    recent = app_state.get("recent_projects", [])

    recent = [
        new_slug if p == old_id else p
        for p in recent
    ]

    app_state["recent_projects"] = recent

    write_app_state(app_state)

    return jsonify({
        "status": "renamed",
        "project": new_slug
    })

@app.route('/delete_project', methods=['POST'])
def api_delete_project():

    data = request.json

    project = data.get("project")

    if not project:
        return jsonify({"error": "Missing project"}), 400

    if project == "default":
        return jsonify({
            "error": "Cannot delete default project"
        }), 400

    project_dir = os.path.join(PROJECTS_DIR, project)

    if not os.path.exists(project_dir):
        return jsonify({"error": "Project not found"}), 404

    app_state = load_app_state()

    # Get all existing projects BEFORE deletion
    all_projects = [
        p for p in os.listdir(PROJECTS_DIR)
        if os.path.isdir(os.path.join(PROJECTS_DIR, p))
        and not p.startswith(".")
    ]

    # Prevent deleting final project
    if len(all_projects) <= 1:
        return jsonify({
            "error": "At least one project must exist"
        }), 400

    # Move the whole project to Projects/.trash instead of deleting it
    move_to_trash(project_dir, os.path.join(PROJECTS_DIR, ".trash"))

    # Remove from recents
    recent = app_state.get("recent_projects", [])

    recent = [
        p for p in recent
        if p != project
    ]

    app_state["recent_projects"] = recent

    # Determine surviving project
    remaining_projects = [
        p for p in all_projects
        if p != project
    ]

    # Prefer most recent surviving project
    new_current = None

    for p in recent:
        if p in remaining_projects:
            new_current = p
            break

    # Fallback alphabetical
    if not new_current and remaining_projects:
        new_current = sorted(remaining_projects)[0]

    # Emergency fallback
    if not new_current:
        new_current = "default"

    # Update current project
    if app_state.get("current_project") == project:
        app_state["current_project"] = new_current

    write_app_state(app_state)

    return jsonify({
        "status": "deleted",
        "current_project": app_state["current_project"]
    })

@app.route('/switch_project', methods=['POST'])
def api_switch_project():

    data = request.json

    project = data.get("project")

    if not project:
        return jsonify({"error": "Missing project"}), 400

    project_dir = os.path.join(PROJECTS_DIR, project)

    if not os.path.exists(project_dir):
        return jsonify({"error": "Project not found"}), 404

    app_state = load_app_state()

    app_state["current_project"] = project

    recent = app_state.get("recent_projects", [])

    if project in recent:
        recent.remove(project)

    recent.insert(0, project)

    app_state["recent_projects"] = recent[:5]

    write_app_state(app_state)

    return jsonify({"status": "switched"})


"""
# -----------test route-------------- - deprecated?
@app.route('/test_create')
def test_create():
    with app.test_request_context(json={
        "section": "writing",
        "title": "Chapter One"
    }):
        return create_item()

@app.route('/test_load')
def test_load():
    with app.test_request_context(json={
        "section": "writing",
        "filename": "chapter-one.json"
    }):
        return load_file()

@app.route('/test_save')
def test_save():
    with app.test_request_context(json={
        "section": "writing",
        "filename": "chapter-one.json",
        "title": "Chapter One",
        "content": "This is a test save."
    }):
        return save_file()
"""











# -------create project files---------
@app.route('/create_item', methods=['POST'])
def api_create_item():
    ensure_structure()

    data = request.json
    section = data.get("section")
    title = data.get("title")

    if not section or not title:
        return jsonify({"error": "Missing data"}), 400

    filename = slugify(title) + ".json"

    base_path = get_base_path(section)
    state_file = get_state_file(section)
    state_key = section



    file_path = os.path.join(base_path, filename)

    # Prevent overwrite
    if os.path.exists(file_path):
        return jsonify({"error": "File already exists"}), 400

    # Create file
    save_json(file_path, {
        "id": filename.replace(".json", ""),
        "title": title,
        "content": ""
    })

    # Update state
    state = load_json(state_file)

    state[state_key].append({
        "type": "file",
        "filename": filename,
        "title": title,
        "wordCount": 0
    })


    save_json(state_file, state)

    return jsonify({"status": "created", "filename": filename})


@app.route('/create_item_in_folder', methods=['POST'])
def api_create_item_in_folder():

    ensure_structure()

    data = request.json

    section = data.get("section")
    folder_id = data.get("folder_id")
    title = data.get("title")

    if not section or not folder_id or not title:
        return jsonify({
            "error": "Missing data"
        }), 400

    filename = slugify(title) + ".json"

    base_path = get_base_path(section)

    file_path = os.path.join(
        base_path,
        filename
    )

    if os.path.exists(file_path):
        return jsonify({
            "error": "File already exists"
        }), 400

    save_json(file_path, {
        "id": filename.replace(
            ".json",
            ""
        ),
        "title": title,
        "content": ""
    })

    state_file = get_state_file(section)

    state = load_json(state_file)

    folder = find_folder(
        state[section],
        folder_id
    )

    if not folder:

        return jsonify({
            "error": "Folder not found"
        }), 404

    folder["items"].append({
        "type": "file",
        "filename": filename,
        "title": title,
        "wordCount": 0
    })

    save_json(
        state_file,
        state
    )

    return jsonify({
        "status": "created",
        "filename": filename
    })


# -------save project files---------
@app.route('/save_file', methods=['POST'])
def api_save_file():
    ensure_structure()

    data = request.json
    section = data.get("section")
    filename = data.get("filename")
    content = data.get("content")
    title = data.get("title")
    word_count = count_words(content)

    if not section or not filename:
        return jsonify({"error": "Missing data"}), 400

    base_path = get_base_path(section)

    file_path = os.path.join(base_path, filename)

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    # Keep the previous text as a version before overwriting it
    previous = load_json(file_path) or {}
    if previous.get("content") and previous.get("content") != content:
        snapshot_file(section, filename)

    save_json(file_path, {
        "id": filename.replace(".json", ""),
        "title": title,
        "content": content,
        "wordCount": word_count
    })

    # Update last opened + title in state
    state_file = get_state_file(section)

    state = load_json(state_file)

    # Update title in state
    item = find_file_item(
        state.get(section, []),
        filename
    )

    if item:
        item["title"] = title
        item["wordCount"] = word_count

    save_json(state_file, state)


    return jsonify({
        "status": "saved",
        "wordCount": word_count
    })


# -------create folders---------
@app.route('/create_folder', methods=['POST'])
def api_create_folder():
    ensure_structure()

    data = request.json

    section = data.get("section")
    title = data.get("title")

    if not section or not title:
        return jsonify({"error": "Missing data"}), 400

    state_file = get_state_file(section)

    state = load_json(state_file)

    state[section].append({
        "type": "folder",
        "id": slugify(title),
        "title": title,
        "collapsed": False,
        "items": []
    })

    save_json(state_file, state)

    return jsonify({"status": "created"})



# -------load project files---------
@app.route('/load_file', methods=['POST'])
def api_load_file():
    ensure_structure()

    data = request.json

    section = data.get("section")
    filename = data.get("filename")

    if not section or not filename:
        return jsonify({"error": "Missing data"}), 400

    base_path = get_base_path(section)

    file_path = os.path.join(base_path, filename)

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    content = load_json(file_path)

    return jsonify(content)



# -------persist project folder state---------
@app.route('/update_folder_state', methods=['POST'])
def api_update_folder_state():
    ensure_structure()

    data = request.json

    section = data.get("section")
    state_data = data.get("state")

    if not section or state_data is None:
        return jsonify({"error": "Missing data"}), 400

    state_file = get_state_file(section)

    state = load_json(state_file)

    state[section] = state_data

    save_json(state_file, state)

    return jsonify({"status": "saved"})



# ----- ELLIPSIS MENU ITEMS ----

@app.route('/delete_item', methods=['POST'])
def api_delete_item():
    ensure_structure()

    data = request.json
    section = data.get("section")
    filename = data.get("filename")

    if not section or not filename:
        return jsonify({"error": "Missing data"}), 400

    # Determine path + state
    base_path = get_base_path(section)
    state_file = get_state_file(section)

    file_path = os.path.join(base_path, filename)

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    state = load_json(state_file)
    folder_id = parent_folder_id(state.get(section, []), filename)

    # Move the file to the section's trash instead of deleting it
    trash_root = os.path.join(base_path, ".trash")
    trash_name = move_to_trash(file_path, trash_root)
    remember_trash(trash_root, trash_name, {"filename": filename, "folder": folder_id or None})

    # Update state

    state[section] = remove_file_from_tree(state.get(section, []), filename)

    # Clear last opened if needed
    if section in ["prompts", "system"]:
        key = "last_opened_global"
    else:
        key = "last_opened_project"

    if state.get(key, {}).get("filename") == filename:
        state[key] = {}


    save_json(state_file, state)

    return jsonify({"status": "deleted"})



@app.route('/rename_item', methods=['POST'])
def api_rename_item():
    ensure_structure()

    data = request.json
    section = data.get("section")
    filename = data.get("filename")
    new_title = data.get("title")

    if not section or not filename or not new_title:
        return jsonify({"error": "Missing data"}), 400

    new_filename = slugify(new_title) + ".json"

    base_path = get_base_path(section)
    state_file = get_state_file(section)

    old_path = os.path.join(base_path, filename)
    new_path = os.path.join(base_path, new_filename)

    if not os.path.exists(old_path):
        return jsonify({"error": "File not found"}), 404

    if os.path.exists(new_path):
        return jsonify({"error": "Target filename exists"}), 400


    # Load file content
    content = load_json(old_path)

    content["title"] = new_title
    content["id"] = new_filename.replace(".json", "")

    save_json(new_path, content)

    os.remove(old_path)

    # Version history follows the file to its new name
    old_history = history_dir(section, filename)
    new_history = history_dir(section, new_filename)
    if os.path.isdir(old_history) and not os.path.exists(new_history):
        os.rename(old_history, new_history)

    # Update state
    state = load_json(state_file)

    item = find_file_item(
        state.get(section, []),
        filename
    )

    if item:
        item["filename"] = new_filename
        item["title"] = new_title

    if section in ["prompts", "system"]:
        key = "last_opened_global"
    else:
        key = "last_opened_project"

    if state.get(key, {}).get("filename") == filename:
        state[key]["filename"] = new_filename


    save_json(state_file, state)

    return jsonify({
        "status": "renamed",
        "filename": new_filename
    })


@app.route('/rename_folder', methods=['POST'])
def api_rename_folder():

    ensure_structure()

    data = request.json

    section = data.get("section")
    folder_id = data.get("folder_id")
    new_title = data.get("title")

    if not section or not folder_id or not new_title:
        return jsonify({
            "error": "Missing data"
        }), 400

    state_file = get_state_file(section)

    state = load_json(state_file)

    folder = find_folder(
        state.get(section, []),
        folder_id
    )

    if not folder:
        return jsonify({
            "error": "Folder not found"
        }), 404

    folder["title"] = new_title

    save_json(
        state_file,
        state
    )

    return jsonify({
        "status": "renamed"
    })


@app.route('/delete_folder', methods=['POST'])
def api_delete_folder():

    ensure_structure()

    data = request.json

    section = data.get("section")
    folder_id = data.get("folder_id")

    if not section or not folder_id:
        return jsonify({
            "error": "Missing data"
        }), 400

    state_file = get_state_file(section)

    state = load_json(state_file)

    folder = find_folder(
        state.get(section, []),
        folder_id
    )

    if not folder:
        return jsonify({
            "error": "Folder not found"
        }), 404

    if folder.get("items"):
        return jsonify({
            "error": "Folder is not empty"
        }), 400

    remove_folder(
        state[section],
        folder_id
    )

    save_json(
        state_file,
        state
    )

    return jsonify({
        "status": "deleted"
    })


# ----- DUPLICATE A DOCUMENT, FOLDER, OR PROJECT -----

def free_name(exists, stem):
    """stem-copy, then stem-copy-2, -3 ... whichever is free."""
    candidate, n = f"{stem}-copy", 1
    while exists(candidate):
        n += 1
        candidate = f"{stem}-copy-{n}"
    return candidate


def copy_document(section, filename, mark_copy=True):
    """Copy one document file; returns its new sidebar entry."""
    base = get_base_path(section)
    data = load_json(os.path.join(base, filename)) or {}
    stem = filename[:-5] if filename.endswith(".json") else filename
    new_stem = free_name(lambda c: os.path.exists(os.path.join(base, f"{c}.json")), stem)
    title = data.get("title") or stem
    if mark_copy:
        title = f"{title} (copy)"
    content = data.get("content", "")
    save_json(os.path.join(base, f"{new_stem}.json"), {
        "id": new_stem,
        "title": title,
        "content": content,
        "wordCount": count_words(content)
    })
    return {"type": "file", "filename": f"{new_stem}.json", "title": title, "wordCount": count_words(content)}


def folder_ids(items):
    ids = set()
    for item in items or []:
        if isinstance(item, dict) and item.get("type") == "folder":
            ids.add(item.get("id"))
            ids |= folder_ids(item.get("items"))
    return ids


def copy_folder(section, folder, taken_ids):
    """Copy a folder and everything in it; documents inside keep their titles."""
    new_id = free_name(lambda c: c in taken_ids, folder.get("id") or "folder")
    taken_ids.add(new_id)
    items = []
    for item in folder.get("items", []):
        if isinstance(item, dict) and item.get("type") == "folder":
            items.append(copy_folder(section, item, taken_ids))
        else:
            filename = item if isinstance(item, str) else item.get("filename")
            if filename and os.path.exists(os.path.join(get_base_path(section), filename)):
                items.append(copy_document(section, filename, mark_copy=False))
    return {
        "type": "folder",
        "id": new_id,
        "title": folder.get("title"),
        "collapsed": folder.get("collapsed", False),
        "items": items
    }


def insert_after_folder(items, folder_id, entry):
    for i, item in enumerate(items):
        if isinstance(item, dict) and item.get("type") == "folder":
            if item.get("id") == folder_id:
                items.insert(i + 1, entry)
                return True
            if insert_after_folder(item.get("items", []), folder_id, entry):
                return True
    return False


@app.route('/duplicate_item', methods=['POST'])
def api_duplicate_item():
    ensure_structure()
    data = request.json
    section = data.get("section")
    filename = data.get("filename")

    if not section or not filename:
        return jsonify({"error": "Missing data"}), 400
    if not os.path.exists(os.path.join(get_base_path(section), filename)):
        return jsonify({"error": "File not found"}), 404

    entry = copy_document(section, filename)
    state_file = get_state_file(section)
    state = load_json(state_file)
    insert_into_tree(state.setdefault(section, []), entry, target_filename=filename, position="after")
    save_json(state_file, state)
    return jsonify({"status": "duplicated", "filename": entry["filename"], "title": entry["title"]})


@app.route('/duplicate_folder', methods=['POST'])
def api_duplicate_folder():
    ensure_structure()
    data = request.json
    section = data.get("section")
    folder_id = data.get("folder_id")

    if not section or not folder_id:
        return jsonify({"error": "Missing data"}), 400

    state_file = get_state_file(section)
    state = load_json(state_file)
    tree = state.setdefault(section, [])
    folder = find_folder(tree, folder_id)
    if not folder:
        return jsonify({"error": "Folder not found"}), 404

    copy = copy_folder(section, folder, folder_ids(tree))
    copy["title"] = f"{folder.get('title')} (copy)"
    insert_after_folder(tree, folder_id, copy)
    save_json(state_file, state)
    return jsonify({"status": "duplicated", "folder_id": copy["id"], "title": copy["title"]})


@app.route('/duplicate_project', methods=['POST'])
def api_duplicate_project():
    data = request.json
    project = data.get("project")
    src = os.path.join(PROJECTS_DIR, project or "")

    if not project or not os.path.isdir(src):
        return jsonify({"error": "Project not found"}), 404

    new_id = free_name(lambda c: os.path.exists(os.path.join(PROJECTS_DIR, c)), project)
    dest = os.path.join(PROJECTS_DIR, new_id)
    # The copy starts clean: no version history, trash, or temp files
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns(".history", ".trash", ".tmp-*"))

    meta = load_json(os.path.join(src, "project.json")) or {}
    title = f"{meta.get('title') or project} (copy)"
    save_json(os.path.join(dest, "project.json"), {**meta, "id": new_id, "title": title})
    return jsonify({"status": "duplicated", "project": new_id, "title": title})


# ----- OPENROUTER MODEL CHECK -----
OPENROUTER_CATALOG = os.path.join(GLOBAL_DIR, "openrouter_models.json")
CATALOG_MAX_AGE = 24 * 60 * 60   # seconds; the app refreshes prices once a day


def refresh_openrouter_catalog():
    """Fetch OpenRouter's live model list and keep a compact copy. Raises on network errors."""
    response = requests.get("https://openrouter.ai/api/v1/models", timeout=20)
    response.raise_for_status()
    live = response.json().get("data", [])

    catalog = {
        m["id"]: {
            "name": m.get("name"),
            "context": m.get("context_length"),
            "expires": m.get("expiration_date"),
            "reasoning": m.get("reasoning"),
            "temperature": "temperature" in (m.get("supported_parameters") or []),
            # Dollars per token; base rates (some models list time-of-day discounts)
            "price": {
                "in": per_token_price((m.get("pricing") or {}).get("prompt")),
                "out": per_token_price((m.get("pricing") or {}).get("completion"))
            },
            "max_out": (m.get("top_provider") or {}).get("max_completion_tokens")
        }
        for m in live if m.get("id")
    }
    checked_at = datetime.now().isoformat(timespec="seconds")
    save_json(OPENROUTER_CATALOG, {"checked_at": checked_at, "models": catalog})
    return checked_at, catalog


@app.route('/check_openrouter_models', methods=['POST'])
def api_check_openrouter_models():
    """Fetch OpenRouter's live model list, keep a compact copy, and report on the user's models."""
    try:
        checked_at, catalog = refresh_openrouter_catalog()
    except Exception as e:
        return jsonify({"error": f"Could not reach OpenRouter: {e}"}), 502

    report = []
    for model in (load_model_list() or {}).get("openrouter", []):
        info = catalog.get(model.get("id"))
        report.append({
            "id": model.get("id"),
            "name": model.get("name") or model.get("id"),
            "status": "gone" if not info else ("leaving" if info.get("expires") else "available"),
            "expires": info.get("expires") if info else None
        })

    return jsonify({"checked_at": checked_at, "total": len(catalog), "models": report})


@app.route('/openrouter_catalog', methods=['GET'])
def api_openrouter_catalog():
    """The saved copy of OpenRouter's model list. With ?auto=1 it is fetched again
    first when it is missing, older than a day, or from before prices were kept."""
    saved = (load_json(OPENROUTER_CATALOG) or {}) if os.path.exists(OPENROUTER_CATALOG) else {}

    if request.args.get("auto"):
        try:
            age = datetime.now() - datetime.fromisoformat(saved.get("checked_at", ""))
            stale = age.total_seconds() > CATALOG_MAX_AGE
        except (TypeError, ValueError):
            stale = True
        has_prices = any("price" in m for m in saved.get("models", {}).values())
        if stale or not has_prices:
            try:
                checked_at, catalog = refresh_openrouter_catalog()
                saved = {"checked_at": checked_at, "models": catalog}
            except Exception:
                pass  # Offline: keep the old copy

    return jsonify(saved)


# ----- MOVE A FILE TO ANOTHER SECTION -----

@app.route('/move_file_section', methods=['POST'])
def api_move_file_section():
    ensure_structure()

    data = request.json
    from_section = data.get("from_section")
    to_section = data.get("section")
    filename = data.get("filename")

    if from_section not in SECTIONS or not to_section or not filename:
        return jsonify({"error": "Missing data"}), 400

    if from_section == to_section:
        return jsonify({"error": "File is already in this section"}), 400

    src = os.path.join(get_base_path(from_section), filename)
    dest = os.path.join(get_base_path(to_section), filename)

    if not os.path.exists(src):
        return jsonify({"error": "File not found"}), 404

    if os.path.exists(dest):
        return jsonify({
            "error": f"{to_section.title()} already has a file with this name"
        }), 400

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)

    # Version history follows the file
    old_history = history_dir(from_section, filename)
    new_history = history_dir(to_section, filename)
    if os.path.isdir(old_history) and not os.path.exists(new_history):
        os.makedirs(os.path.dirname(new_history), exist_ok=True)
        shutil.move(old_history, new_history)

    # Take it out of the source list (keeping its title and word count)
    source_state_file = get_state_file(from_section)
    source_state = load_json(source_state_file)
    old_item = find_file_item(source_state.get(from_section, []), filename)
    entry = {"type": "file", "filename": filename}
    if isinstance(old_item, dict):
        entry.update({k: old_item[k] for k in ("title", "wordCount") if k in old_item})
    source_state[from_section] = remove_file_from_tree(
        source_state.get(from_section, []), filename
    )
    save_json(source_state_file, source_state)

    # Put it into the target list; reload, as both lists may share a state file
    target_state_file = get_state_file(to_section)
    target_state = load_json(target_state_file)
    insert_into_tree(
        target_state.setdefault(to_section, []),
        entry,
        folder_id=data.get("folder_id"),
        target_filename=data.get("target_filename"),
        position=data.get("position", "after")
    )
    save_json(target_state_file, target_state)

    return jsonify({"status": "moved", "section": to_section, "filename": filename})


# ----- VERSION HISTORY -----

@app.route('/file_history', methods=['POST'])
def api_file_history():
    ensure_structure()

    data = request.json
    section = data.get("section")
    filename = data.get("filename")

    if not section or not filename:
        return jsonify({"error": "Missing data"}), 400

    versions = []
    for version_id in reversed(list_versions(section, filename)):
        version = load_json(
            os.path.join(history_dir(section, filename), f"{version_id}.json")
        ) or {}
        versions.append({
            "id": version_id,
            "time": version_time(version_id).isoformat(),
            "title": version.get("title", ""),
            "words": count_words(version.get("content", ""))
        })

    return jsonify({"versions": versions})


@app.route('/file_version', methods=['POST'])
def api_file_version():
    ensure_structure()

    data = request.json
    section = data.get("section")
    filename = data.get("filename")
    version_id = data.get("id", "")

    if not section or not filename or not VERSION_ID.match(version_id):
        return jsonify({"error": "Missing data"}), 400

    path = os.path.join(history_dir(section, filename), f"{version_id}.json")
    if not os.path.exists(path):
        return jsonify({"error": "Version not found"}), 404

    version = load_json(path) or {}
    return jsonify({
        "title": version.get("title", ""),
        "content": version.get("content", "")
    })


@app.route('/restore_version', methods=['POST'])
def api_restore_version():
    ensure_structure()

    data = request.json
    section = data.get("section")
    filename = data.get("filename")
    version_id = data.get("id", "")

    if not section or not filename or not VERSION_ID.match(version_id):
        return jsonify({"error": "Missing data"}), 400

    file_path = os.path.join(get_base_path(section), filename)
    version_path = os.path.join(history_dir(section, filename), f"{version_id}.json")

    if not os.path.exists(file_path) or not os.path.exists(version_path):
        return jsonify({"error": "Version not found"}), 404

    version = load_json(version_path) or {}
    content = version.get("content", "")
    title = version.get("title") or (load_json(file_path) or {}).get("title", "")
    word_count = count_words(content)

    # Keep the current text as a version too, so a restore can be undone
    snapshot_file(section, filename, force=True)

    save_json(file_path, {
        "id": filename.replace(".json", ""),
        "title": title,
        "content": content,
        "wordCount": word_count
    })

    state_file = get_state_file(section)
    state = load_json(state_file)
    item = find_file_item(state.get(section, []), filename)
    if item:
        item["title"] = title
        item["wordCount"] = word_count
    save_json(state_file, state)

    return jsonify({
        "status": "restored",
        "title": title,
        "content": content,
        "wordCount": word_count
    })


# ----- TRASH -----

@app.route('/trash', methods=['GET'])
def api_trash():
    ensure_structure()
    items = []

    for kind, section, root in trash_roots():
        if not os.path.isdir(root):
            continue
        index = load_trash_index(root)

        for name in os.listdir(root):
            match = TRASH_NAME.match(name)
            if name.startswith(".") or not match:
                continue
            path = os.path.join(root, name)
            original = index.get(name, {}).get("filename") or match.group(2)

            if kind == "project":
                if not os.path.isdir(path):
                    continue
                meta = load_json(os.path.join(path, "project.json")) or {}
                title = meta.get("title") or original
            else:
                data = load_json(path) or {}
                title = data.get("title") or original.replace(".json", "")

            items.append({
                "kind": kind,
                "section": section,
                "trash_name": name,
                "original": original,
                "title": title,
                "deleted": version_time(match.group(1)).isoformat()
            })

    items.sort(key=lambda i: i["trash_name"], reverse=True)
    return jsonify({"items": items, "project": get_current_project()})


@app.route('/restore_trash', methods=['POST'])
def api_restore_trash():
    ensure_structure()

    data = request.json
    kind = data.get("kind")
    section = data.get("section")
    trash_name = data.get("trash_name")

    if not is_safe_name(trash_name) or not TRASH_NAME.match(trash_name):
        return jsonify({"error": "Invalid trash item"}), 400

    if kind == "project":
        root = os.path.join(PROJECTS_DIR, ".trash")
        src = os.path.join(root, trash_name)
        if not os.path.isdir(src):
            return jsonify({"error": "Item not found"}), 404

        project = TRASH_NAME.match(trash_name).group(2)
        if os.path.exists(os.path.join(PROJECTS_DIR, project)):
            project = free_name(lambda c: os.path.exists(os.path.join(PROJECTS_DIR, c)), project)
        dest = os.path.join(PROJECTS_DIR, project)
        shutil.move(src, dest)

        meta_path = os.path.join(dest, "project.json")
        meta = load_json(meta_path) or {}
        if meta and meta.get("id") != project:
            save_json(meta_path, {**meta, "id": project})
        return jsonify({"status": "restored", "project": project})

    if section not in SECTIONS:
        return jsonify({"error": "Missing data"}), 400

    base_path = get_base_path(section)
    root = os.path.join(base_path, ".trash")
    src = os.path.join(root, trash_name)
    if not os.path.isfile(src):
        return jsonify({"error": "Item not found"}), 404

    info = load_trash_index(root).get(trash_name, {})
    filename = info.get("filename") or TRASH_NAME.match(trash_name).group(2)
    if not is_safe_name(filename):
        return jsonify({"error": "Invalid trash item"}), 400

    # Never overwrite a document that took the name in the meantime
    stem = filename[:-5] if filename.endswith(".json") else filename
    if os.path.exists(os.path.join(base_path, f"{stem}.json")):
        stem = free_name(lambda c: os.path.exists(os.path.join(base_path, f"{c}.json")), stem)
    filename = f"{stem}.json"

    doc = load_json(src) or {}
    content = doc.get("content", "")
    title = doc.get("title") or stem
    save_json(os.path.join(base_path, filename), {
        **doc, "id": stem, "title": title, "content": content, "wordCount": count_words(content)
    })
    os.remove(src)
    forget_trash(root, trash_name)

    # Back into its old folder, or the top level if that folder is gone
    state_file = get_state_file(section)
    state = load_json(state_file)
    tree = state.setdefault(section, [])
    insert_into_tree(tree, {
        "type": "file", "filename": filename, "title": title, "wordCount": count_words(content)
    }, folder_id=info.get("folder"))
    save_json(state_file, state)

    return jsonify({"status": "restored", "section": section, "filename": filename})


@app.route('/empty_trash', methods=['POST'])
def api_empty_trash():
    """Delete for good everything the Trash window shows. The client asks first."""
    ensure_structure()
    removed = 0
    for _kind, _section, root in trash_roots():
        if os.path.isdir(root):
            removed += len([n for n in os.listdir(root) if not n.startswith(".")])
            shutil.rmtree(root)
    return jsonify({"status": "emptied", "removed": removed})


@app.route('/save_app_state', methods=['POST'])
def api_save_app_state():

    data = request.json

    state = load_app_state()

    state.update(data)

    save_json(APP_STATE, state)

    return jsonify({"status": "saved"})



# ---------- RUN LAST ----------

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)
