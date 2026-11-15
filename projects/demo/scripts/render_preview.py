#!/usr/bin/env python3
"""
render_preview.py — Headless multi-view wireframe renderer for build123d models.

Takes a STEP file, projects it from multiple angles using b3d_validate's
rendering module (which handles SVG projection, degenerate arc patching,
and safe shape export), converts to token-optimized PNGs via cairosvg.

Usage:
    python render_preview.py model.step
    python render_preview.py model.step -o ./previews --width 512
    python render_preview.py model.step --views front top iso
    python render_preview.py model.step --composite  # 2x2 grid image

Dependencies: build123d, b3d-validate, cairosvg
Optional:     Pillow (for composite grid; graceful fallback if absent)

Part of the Claude × build123d skill toolkit.
"""

from __future__ import annotations

import argparse
import math
import time
from pathlib import Path

from b3d_validate.rendering import render_views, VIEWS, DEFAULT_VIEWS, safe_add_shape

# Custom views with slightly angled cameras to avoid edge-on ellipse rendering issues
VIEWS_CUSTOM = {
    'front': ((0.1, -1, 0.1), (0, 0, 1), 'Front'),      # Slight angle to avoid edge-on
    'top': ((0.1, 0.1, 1), (0, 1, 0), 'Top'),           # Slight angle
    'right': ((1, -0.2, 0.2), (0, 0, 1), 'Right'),      # Angled to show side profile
    'iso': ((1, -1, 0.8), (0, 0, 1), 'Iso'),            # Front-right isometric
}

def _normalise(vec, scale=500):
    """Normalise a vector and scale it."""
    import math
    x, y, z = vec
    length = math.sqrt(x*x + y*y + z*z)
    if length < 1e-9:
        return (0, 0, scale)
    return (x/length * scale, y/length * scale, z/length * scale)

def render_svg_custom(part, view_name: str, output_path, *, line_weight_visible=0.5, line_weight_hidden=0.2):
    """Custom render_svg that uses VIEWS_CUSTOM for better organic model rendering."""
    from build123d import Compound, ExportSVG, LineType
    from build123d.exporters import RGB
    from pathlib import Path

    output_path = Path(output_path)

    # Use custom views if available, fall back to standard
    if view_name in VIEWS_CUSTOM:
        origin_dir, up, _label = VIEWS_CUSTOM[view_name]
    else:
        origin_dir, up, _label = VIEWS[view_name]

    origin = _normalise(origin_dir, scale=500)

    visible, hidden = part.project_to_viewport(origin, viewport_up=up)

    all_edges = visible + hidden
    if not all_edges:
        raise RuntimeError(f"No edges produced for view '{view_name}'")

    bb = Compound(children=all_edges).bounding_box()
    max_dim = max(bb.size.X, bb.size.Y)
    if max_dim < 1e-9:
        max_dim = 1.0

    svg = ExportSVG(scale=90 / max_dim, precision=2)
    svg.add_layer("Visible", line_weight=line_weight_visible)
    svg.add_layer(
        "Hidden",
        line_color=RGB(180, 180, 180),
        line_type=LineType.ISO_DOT,
        line_weight=line_weight_hidden,
    )

    safe_add_shape(svg, visible, "Visible")
    safe_add_shape(svg, hidden, "Hidden")

    svg.write(str(output_path))
    return output_path

# ---------------------------------------------------------------------------
# SVG → PNG via cairosvg
# ---------------------------------------------------------------------------

def svg_to_png(svg_path: Path, png_path: Path, width: int = 400) -> Path:
    """Convert an SVG to a fixed-width PNG. Returns the PNG path."""
    import cairosvg

    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(png_path),
        output_width=width,
        background_color="white",
    )
    return png_path


# ---------------------------------------------------------------------------
# Composite grid (optional, needs Pillow)
# ---------------------------------------------------------------------------

def make_composite(
    png_paths: dict[str, Path],
    output_path: Path,
    cell_width: int = 400,
    label: bool = True,
) -> Path | None:
    """
    Arrange view PNGs in a 2-column grid with optional labels.
    Returns the composite path, or None if Pillow is missing.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None

    names = list(png_paths.keys())
    cols = 2
    rows = math.ceil(len(names) / cols)

    label_h = 24 if label else 0
    # Open images to get actual heights (may differ due to aspect ratio)
    images: dict[str, Image.Image] = {}
    max_h = 0
    for name, p in png_paths.items():
        img = Image.open(p)
        # Scale to cell_width keeping aspect
        ratio = cell_width / img.width
        new_h = int(img.height * ratio)
        img = img.resize((cell_width, new_h), Image.LANCZOS)
        images[name] = img
        max_h = max(max_h, new_h)

    canvas_w = cols * cell_width
    canvas_h = rows * (max_h + label_h)
    canvas = Image.new("RGB", (canvas_w, canvas_h), "white")
    draw = ImageDraw.Draw(canvas) if label else None

    for idx, name in enumerate(names):
        col = idx % cols
        row = idx // cols
        x = col * cell_width
        y = row * (max_h + label_h)

        img = images[name]
        # Centre vertically within the cell
        y_offset = (max_h - img.height) // 2
        canvas.paste(img, (x, y + y_offset))

        if draw:
            _label_text = VIEWS_CUSTOM.get(name, VIEWS.get(name, (None, None, name)))[2]
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
            except (IOError, OSError):
                font = ImageFont.load_default()
            bbox = draw.textbbox((0, 0), _label_text, font=font)
            tw = bbox[2] - bbox[0]
            draw.text(
                (x + (cell_width - tw) // 2, y + max_h + 2),
                _label_text,
                fill="black",
                font=font,
            )

    canvas.save(str(output_path), "PNG", optimize=True)
    return output_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_step(path: Path):
    """Import a STEP file and return the build123d Shape."""
    from build123d import import_step

    parts = import_step(str(path))
    if parts is None:
        raise RuntimeError(f"import_step returned None for {path}")
    return parts


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Render multi-view wireframe PNGs from a build123d STEP file.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n"
               "  %(prog)s model.step\n"
               "  %(prog)s model.step -o ./previews --width 512\n"
               "  %(prog)s model.step --views front top iso\n"
               "  %(prog)s model.step --composite\n",
    )
    parser.add_argument("step_file", type=Path, help="Path to the input STEP file")
    parser.add_argument(
        "-o", "--output-dir", type=Path, default=None,
        help="Output directory (default: same directory as STEP file)",
    )
    parser.add_argument(
        "-p", "--prefix", default=None,
        help="Filename prefix (default: STEP filename stem)",
    )
    parser.add_argument(
        "-w", "--width", type=int, default=400,
        help="Pixel width per view (default: 400 → ~213 tokens each)",
    )
    parser.add_argument(
        "--views", nargs="+", default=DEFAULT_VIEWS, choices=list(VIEWS.keys()),
        help=f"Which views to render (default: {' '.join(DEFAULT_VIEWS)})",
    )
    parser.add_argument(
        "--composite", action="store_true",
        help="Also generate a 2×N composite grid image (needs Pillow)",
    )
    parser.add_argument(
        "--no-hidden", action="store_true",
        help="Omit hidden (dashed) edges for faster, cleaner output",
    )
    parser.add_argument(
        "--keep-svg", action="store_true",
        help="Keep intermediate SVG files (deleted by default)",
    )
    args = parser.parse_args(argv)

    # Resolve paths
    step_path = args.step_file.resolve()
    if not step_path.exists():
        parser.error(f"STEP file not found: {step_path}")

    out_dir = (args.output_dir or step_path.parent).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.prefix or step_path.stem

    # Load model
    t0 = time.perf_counter()
    print(f"Loading {step_path.name} …")
    part = load_step(step_path)
    print(f"  Loaded in {time.perf_counter() - t0:.2f}s")

    # Render each view
    png_paths: dict[str, Path] = {}
    svg_paths: list[Path] = []

    for view_name in args.views:
        t1 = time.perf_counter()
        svg_path = out_dir / f"{prefix}_{view_name}.svg"
        png_path = out_dir / f"{prefix}_{view_name}.png"

        print(f"  Rendering {view_name} …", end=" ", flush=True)
        render_svg_custom(
            part,
            view_name,
            svg_path,
            line_weight_hidden=0.0 if args.no_hidden else 0.2,
        )
        svg_to_png(svg_path, png_path, width=args.width)

        png_size = png_path.stat().st_size
        tokens_est = (args.width * args.width) // 750  # rough estimate
        dt = time.perf_counter() - t1
        print(f"{png_size / 1024:.1f} KB, ~{tokens_est} tokens, {dt:.2f}s")

        png_paths[view_name] = png_path
        svg_paths.append(svg_path)

    # Composite grid
    if args.composite:
        comp_path = out_dir / f"{prefix}_composite.png"
        print(f"  Compositing grid …", end=" ", flush=True)
        result = make_composite(png_paths, comp_path, cell_width=args.width)
        if result:
            comp_tokens = (result.stat().st_size > 0)  # just check it wrote
            from PIL import Image
            img = Image.open(result)
            tokens_est = (img.width * img.height) // 750
            print(f"{result.stat().st_size / 1024:.1f} KB, ~{tokens_est} tokens")
        else:
            print("skipped (Pillow not installed)")

    # Clean up SVGs unless asked to keep
    if not args.keep_svg:
        for p in svg_paths:
            p.unlink(missing_ok=True)

    total = time.perf_counter() - t0
    print(f"\nDone — {len(png_paths)} views in {total:.2f}s → {out_dir}/")


if __name__ == "__main__":
    main()
