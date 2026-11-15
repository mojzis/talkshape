from build123d import *
from b3d_validate import full_check
from datetime import datetime
from pathlib import Path
import math

# --- Parameters ---
thickness = 6  # Extrusion thickness in mm

# --- Build the seahorse profile to match the sketch ---
# Final version with prominent spiral tail matching the reference

# === MAIN BODY ===
body_points = [
    # Snout pointing right (long)
    (75, 94),
    (65, 97),
    (55, 100),
    (45, 102),

    # Crown
    (35, 106),
    (25, 108),
    (18, 104),

    # Back of head
    (12, 96),
    (8, 86),

    # Back curve
    (4, 72),
    (2, 56),
    (4, 40),
    (10, 26),
    (22, 14),
    (36, 6),

    # Tail base - curves down before spiral
    (48, 2),
    (58, 0),

    # Connection point for spiral (right side of body)
    (66, 6),
    (68, 16),
    (64, 26),
    (56, 30),

    # Belly waves - pronounced spikes
    (50, 36),
    (48, 42),
    (42, 36),   # spike
    (48, 50),
    (44, 56),
    (38, 50),   # spike
    (44, 64),
    (40, 70),
    (34, 64),   # spike
    (40, 78),
    (36, 84),
    (30, 78),   # spike

    # Chest
    (34, 88),
    (42, 94),
    (54, 95),
    (66, 94),
    (75, 94),
]

body_face = Polygon(*body_points)

# === SPIRAL TAIL - more prominent ===
# Larger spiral that's clearly visible
cx, cy = 54, 8  # center of spiral (moved closer to tail tip)
start_angle = -0.2  # start angle
total_rotation = 2.5 * math.pi  # about 1.25 full turns
n_points = 40
r_start = 14  # larger starting radius
r_end = 3
width = 4.5  # thicker spiral arm to avoid thin walls

# Outer edge of spiral
outer_points = []
for i in range(n_points):
    t = i / (n_points - 1)
    angle = start_angle + t * total_rotation
    r = r_start - t * (r_start - r_end)
    x = cx + r * math.cos(angle)
    y = cy + r * math.sin(angle)
    outer_points.append((x, y))

# Inner edge (offset inward, ensuring minimum thickness)
inner_points = []
for i in range(n_points):
    t = i / (n_points - 1)
    angle = start_angle + t * total_rotation
    r = r_start - t * (r_start - r_end) - width
    if r < 1.5:  # ensure minimum radius
        r = 1.5
    x = cx + r * math.cos(angle)
    y = cy + r * math.sin(angle)
    inner_points.append((x, y))

# Close the spiral shape
spiral_outline = outer_points + inner_points[::-1]

try:
    spiral_face = Polygon(*spiral_outline)
    profile = body_face + spiral_face
    print("Spiral added successfully")
except Exception as e:
    print(f"Spiral creation failed: {e}")
    profile = body_face

# Add eye
eye_circle = Pos(28, 102) * Circle(2.5)
profile = profile - eye_circle

print(f"Profile area: {profile.area:.1f} mm²")

# Extrude
seahorse = extrude(profile, amount=thickness)

print(f"Solids count: {len(seahorse.solids())}")

# Center the model
bbox = seahorse.bounding_box()
center_x = (bbox.min.X + bbox.max.X) / 2
center_y = (bbox.min.Y + bbox.max.Y) / 2
seahorse = Pos(-center_x, -center_y, 0) * seahorse

print(f"Final bounding box: {seahorse.bounding_box()}")
bbox = seahorse.bounding_box()
print(f"Size: {bbox.max.X - bbox.min.X:.1f} x {bbox.max.Y - bbox.min.Y:.1f} x {bbox.max.Z - bbox.min.Z:.1f} mm")

# --- Validate ---
report = full_check(seahorse)
print(report)

# --- Export ---
script_name = Path(__file__).stem
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
steps_dir = Path("steps")
steps_dir.mkdir(exist_ok=True)
step_path = steps_dir / f"{script_name}_{timestamp}.step"
export_step(seahorse, str(step_path))
print(f"Exported: {step_path}")
