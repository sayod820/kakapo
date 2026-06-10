"""Логика заказов (смешанные / сборщик / курьер / ресторан)."""


def _market_items(items: list) -> list:
    return [it for it in items if it.get("source") == "market" or (not it.get("restId") and it.get("source") != "restaurant")]


def _rest_items(items: list, rest_id: str | None = None) -> list:
    out = []
    for it in items:
        if it.get("source") == "restaurant" or it.get("restId"):
            if rest_id is None or str(it.get("restId")) == str(rest_id):
                out.append(it)
    return out


def infer_type(order: dict) -> str:
    if order.get("type") == "mixed":
        return "mixed"
    items = order.get("items") or []
    has_market = len(_market_items(items)) > 0
    has_rest = len(_rest_items(items)) > 0
    if has_market and has_rest:
        return "mixed"
    if has_rest:
        return "restaurant"
    return order.get("type") or "market"


def get_market_status(order: dict) -> str:
    if order.get("marketStatus"):
        return order["marketStatus"]
    items = order.get("items") or []
    if not _market_items(items):
        return "done"
    st = order.get("status", "new")
    if st == "assembler_done":
        return "done"
    if st == "assembling":
        return "assembling"
    return "new"


def get_rest_part_status(order: dict, rest_id: str) -> str:
    parts = order.get("restParts") or {}
    if rest_id in parts:
        return parts[rest_id]
    if not _rest_items(order.get("items") or [], rest_id):
        return "done"
    if infer_type(order) == "mixed":
        return "new"
    st = order.get("status", "new")
    if st in ("ready", "assembler_done", "courier_picked", "delivering", "delivered"):
        return "done"
    if st == "cooking":
        return "cooking"
    return "new"


def all_parts_done(order: dict) -> bool:
    items = order.get("items") or []
    if _market_items(items) and get_market_status(order) != "done":
        return False
    rest_ids = set()
    if order.get("restId"):
        rest_ids.add(str(order["restId"]))
    for rid in order.get("restIds") or []:
        rest_ids.add(str(rid))
    for it in _rest_items(items):
        if it.get("restId"):
            rest_ids.add(str(it["restId"]))
    for rid in rest_ids:
        if get_rest_part_status(order, rid) != "done":
            return False
    return True


def is_assembler_order(order: dict) -> bool:
    otype = infer_type(order)
    if otype == "mixed":
        ms = get_market_status(order)
        return ms in ("new", "assembling")
    return otype == "market" and order.get("status") in ("new", "assembling")


def is_courier_ready(order: dict) -> bool:
    st = order.get("status")
    if st in ("delivered", "cancelled"):
        return False
    otype = infer_type(order)
    if otype == "mixed":
        return all_parts_done(order) and st == "assembler_done"
    if otype == "market":
        return st == "assembler_done"
    if otype == "restaurant":
        return st == "ready"
    return False


def is_courier_sync(order: dict) -> bool:
    st = order.get("status")
    if st in ("delivered", "cancelled"):
        return False
    return is_courier_ready(order) or st in ("courier_picked", "delivering")


def sync_mixed_status(order: dict) -> dict:
    otype = infer_type(order)
    if otype != "mixed":
        return order
    if all_parts_done(order):
        order["status"] = "assembler_done"
    elif get_market_status(order) == "assembling":
        order["status"] = "assembling"
    else:
        order["status"] = "new"
    return order


def apply_status_patch(order: dict, body: dict) -> dict:
    status = body.get("status")
    if body.get("marketStatus") is not None:
        order["marketStatus"] = body["marketStatus"]
    if body.get("restParts") is not None:
        order["restParts"] = {** (order.get("restParts") or {}), **body["restParts"]}

    otype = infer_type(order)
    if otype == "mixed":
        order = sync_mixed_status(order)
        if status and status not in ("new", "assembling", "assembler_done"):
            order["status"] = status
    elif status:
        order["status"] = status
    return order
