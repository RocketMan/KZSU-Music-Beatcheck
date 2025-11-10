#!/usr/bin/env python3
"""
Generate a stacked-bar response-times chart using QuickChart (no local chart deps).

- Reads metrics/metrics.csv (first column = ISO timestamp, other columns include timing columns).
- Detects timing columns (headers ending with "Time" or containing "total").
- Produces:
  - metrics/stacked-times-quickchart.png   (downloaded from QuickChart)
  - metrics/stacked-times-quickchart.html  (interactive Chart.js HTML using CDN)

Usage:
  python3 scripts/generate-stacked-times-quickchart.py --points 500 --out-png metrics/stacked-times-quickchart.png --out-html metrics/stacked-times-quickchart.html
"""
import csv
import json
import os
import sys
import argparse
from urllib import request, parse, error
from datetime import datetime, timezone, timedelta

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--csv", default="metrics/metrics.csv")
    p.add_argument("--points", type=int, default=0)
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--interval", type=int, default=5)
    p.add_argument("--out-png", default="metrics/stacked-times-quickchart.png")
    p.add_argument("--out-html", default="metrics/stacked-times-quickchart.html")
    p.add_argument("--quickchart-url", default="https://quickchart.io")
    p.add_argument("--max-points", type=int, default=800)
    return p.parse_args()

def read_csv(path):
    if not os.path.exists(path):
        return None, None
    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.reader(fh)
        rows = list(reader)
    if len(rows) < 2:
        return None, None
    header = [h.strip() for h in rows[0]]
    data = [[c.strip() for c in r] for r in rows[1:] if any(c.strip() for c in r)]
    return header, data

def iso_or_empty(s):
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d.astimezone(timezone.utc).isoformat()
    except Exception:
        return ""

def choose_colors(n):
    base = [
        "#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b",
        "#e377c2","#7f7f7f","#bcbd22","#17becf","#aec7e8","#ffbb78"
    ]
    colors = [base[i % len(base)] for i in range(n)]
    return colors

def build_chart_config(labels, datasets, title):
    config = {
      "type": "bar",
      "data": {
        "labels": labels,
        "datasets": datasets
      },
      "options": {
        "responsive": False,
        "plugins": {
          "title": { "display": True, "text": title },
          "legend": { "position": "bottom" },
          "tooltip": {
            "mode": "index",
            "intersect": False
          }
        },
        "scales": {
          "x": {
            "stacked": True,
            "ticks": { "maxRotation": 45, "autoSkip": True, "maxTicksLimit": 20 },
            "title": { "display": True, "text": "Run timestamp (UTC)" }
          },
          "y": {
            "stacked": True,
            "beginAtZero": True,
            "title": { "display": True, "text": "Elapsed time (ms)" }
          }
        },
        "interaction": { "mode": "nearest", "intersect": False }
      }
    }
    return config

def post_quickchart_png(qurl, chart_config, width=1400, height=700, timeout=30):
    # POST to /chart with JSON body to get PNG bytes
    url = qurl.rstrip("/") + "/chart"
    payload = {
        "chart": chart_config,
        "width": width,
        "height": height,
        "format": "png"
    }
    data = json.dumps(payload).encode("utf8")
    req = request.Request(url, data=data, headers={"Content-Type":"application/json"})
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except error.HTTPError as e:
        # include response body if available for debugging
        body = e.read().decode("utf8", errors="ignore") if hasattr(e, 'read') else ""
        raise RuntimeError(f"QuickChart HTTP error: {e.code} {e.reason} {body}")

def make_interactive_html(chart_config, outpath, title):
    # HTML embeds Chart.js from CDN and uses the same config
    config_json = json.dumps(chart_config, indent=2)
    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>{title}</title>
  <style>body{{font-family:Arial,Helvetica,sans-serif;padding:16px}}canvas{{max-width:100%;height:auto}}</style>
</head>
<body>
  <h2>{title}</h2>
  <div><button id="resetZoom">Reset zoom</button> <small>Drag to zoom / scroll to zoom / right-drag to pan</small></div>
  <canvas id="chart" width="1400" height="700"></canvas>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
  <script>
    const cfg = {config_json};
    Chart.register(ChartZoom);
    const ctx = document.getElementById('chart').getContext('2d');
    const chart = new Chart(ctx, cfg);
    document.getElementById('resetZoom').addEventListener('click', () => chart.resetZoom());
  </script>
</body>
</html>"""
    os.makedirs(os.path.dirname(outpath) or ".", exist_ok=True)
    with open(outpath, "w", encoding="utf8") as fh:
        fh.write(html)

def main():
    args = parse_args()
    header, rows = read_csv(args.csv)
    if header is None:
        print(f"CSV not found or empty at {args.csv}", file=sys.stderr)
        sys.exit(1)

    # detect timestamp column = first column
    ts_col = 0
    # detect timing columns: header endswith Time or contains 'total'
    timing_cols = [(i,h) for i,h in enumerate(header) if i!=ts_col and (h.endswith("Time") or "total" in h.lower())]
    if not timing_cols:
        print("No timing columns detected in CSV header:", header, file=sys.stderr)
        sys.exit(1)

    # build records with iso timestamp and numeric ms values
    records = []
    for r in rows:
        ts = iso_or_empty(r[ts_col]) if len(r)>ts_col else ""
        if not ts:
            continue
        vals = {}
        for i,h in timing_cols:
            raw = r[i] if i < len(r) else "0"
            try:
                num = float(raw)
            except Exception:
                num = 0.0
            vals[h] = num
        records.append((ts, vals))

    if not records:
        print("No valid rows with timestamps found", file=sys.stderr)
        sys.exit(1)

    # decide points
    if args.points and args.points > 0:
        points = min(args.points, len(records))
    else:
        expected_per_day = round(1440 / max(1, args.interval))
        points = min(args.max_points, expected_per_day * max(1, args.days), len(records))

    slice_records = records[-points:]
    labels = [r[0] for r in slice_records]

    # build all datasets (including total if present)
    cols = [h for i,h in timing_cols]
    colors = choose_colors(len(cols))
    all_datasets = []
    for idx,col in enumerate(cols):
        data = [r[1].get(col, 0) for r in slice_records]
        ds = {
            "label": col,
            "data": data,
            "backgroundColor": colors[idx],
            "stack": "stack1",
            "borderWidth": 0.5,
            "borderColor": "#222"
        }
        all_datasets.append(ds)

    # Separate the total dataset (case-insensitive 'total' in label), exclude it from stacked bars
    total_idx = next((i for i,d in enumerate(all_datasets) if "total" in d["label"].lower()), None)
    total_dataset = None
    if total_idx is not None:
        td = all_datasets.pop(total_idx)
        # make an overlaid line dataset for total
        total_dataset = {
            "label": td["label"],
            "data": td["data"],
            "type": "line",
            "borderColor": "#d62728",
            "backgroundColor": "rgba(214,39,40,0.12)",
            "borderWidth": 2.5,
            "pointRadius": 2,
            "fill": False,
            # don't set 'stack' so it won't participate in stacking
        }

    # Use remaining datasets as stacked bar slices
    stacked_datasets = all_datasets

    # final datasets to render: stacked bars first, then optional total line
    render_datasets = list(stacked_datasets)
    if total_dataset is not None:
        render_datasets.append(total_dataset)

    title = f"Per-run elapsed times (stacked) — last {points} runs — unit: ms"
    chart_config = build_chart_config(labels, render_datasets, title)

    # generate PNG via QuickChart
    print("Posting chart config to QuickChart...")
    try:
        png_bytes = post_quickchart_png(args.quickchart_url, chart_config)
        os.makedirs(os.path.dirname(args.out_png) or ".", exist_ok=True)
        with open(args.out_png, "wb") as fh:
            fh.write(png_bytes)
        print("Wrote PNG:", args.out_png)
    except Exception as e:
        print("Failed to fetch PNG from QuickChart:", e, file=sys.stderr)
        # still try to write HTML for interactive inspection
    try:
        make_interactive_html(chart_config, args.out_html, title)
        print("Wrote interactive HTML:", args.out_html)
    except Exception as e:
        print("Failed to write interactive HTML:", e, file=sys.stderr)

if __name__ == "__main__":
    main()
