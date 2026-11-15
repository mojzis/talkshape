from build123d import *
from b3d_validate import full_check
from datetime import datetime
from pathlib import Path
import math

# --- Parameters ---
# Shell parameters - larger spiral shell like in the SVG
num_turns = 3.2
points_per_turn = 30
growth_rate = 1.22  # shell grows by this factor per turn
initial_radius = 2.5
vertical_growth = 1.5  # flatter shell like in the SVG (viewed from side)
tube_radius_start = 10  # larger shell opening
tube_radius_end = 1.0  # shell tip size

# Body parameters
body_length = 55
body_width = 16
body_height = 9

# Eye stalk parameters
stalk_length = 28
eye_radius = 4.5

# --- Build Shell using logarithmic spiral ---
total_points = int(num_turns * points_per_turn)
spiral_points = []

for i in range(total_points + 1):
    t = i / points_per_turn  # turns completed
    angle = 2 * math.pi * t

    # Logarithmic spiral: r = a * b^t
    r = initial_radius * (growth_rate ** t)
    x = r * math.cos(angle)
    y = r * math.sin(angle)
    z = t * vertical_growth

    spiral_points.append((x, y, z))

# Create the shell path
shell_path = Spline(*spiral_points)

# Create shell by lofting circles of decreasing size along the path
num_sections = 50
shell_sections = []

for i in range(num_sections):
    param = i / (num_sections - 1)
    loc = shell_path ^ param

    # Radius decreases as we go toward the apex
    section_radius = tube_radius_start * (1 - param) + tube_radius_end * param

    section = loc * Circle(section_radius)
    shell_sections.append(section)

shell = loft(shell_sections)

# Add a smooth cap at the apex
apex_loc = shell_path ^ 1.0
apex = apex_loc * Sphere(tube_radius_end)
shell = shell + apex

# Position the shell on the body - larger and more prominent
shell = Pos(-5, 0, body_height + 4) * Rot(90, 0, -150) * shell

# --- Build Body (the snail's muscular foot) ---
# Use loft for organic tapered body shape
body_sections = []

# Back of body (near shell)
body_sections.append(Ellipse(body_width / 2, body_height / 2))

# Middle sections
body_sections.append(Pos(0, 0, body_length * 0.3) * Ellipse(body_width / 2 * 0.95, body_height / 2 * 0.9))
body_sections.append(Pos(0, 0, body_length * 0.6) * Ellipse(body_width / 2 * 0.75, body_height / 2 * 0.8))

# Front (head area) - tapers to connect to head
body_sections.append(Pos(0, 0, body_length * 0.85) * Ellipse(body_width / 2 * 0.5, body_height / 2 * 0.7))

body = loft(body_sections)

# Rotate body to extend along X axis
body = Rot(0, -90, 0) * body
body = Pos(-body_length * 0.3, 0, body_height / 2) * body

# --- Build Head ---
head = scale(Sphere(body_width / 3), by=(1.4, 1, 0.9))
head = Pos(-body_length * 0.65, 0, body_height / 2 + 2) * head

# --- Build Eye Stalks (curved like in the SVG) ---
# Left eye stalk - curves upward and outward
left_stalk_points = [
    (0, 0, 0),
    (-2, -4, 8),
    (-4, -7, 16),
    (-3, -9, stalk_length)
]
left_stalk_path = Spline(*left_stalk_points)
left_stalk_section = Plane(left_stalk_path ^ 0) * Circle(1.5)
left_stalk = sweep(left_stalk_section, path=left_stalk_path)
left_stalk = Pos(-body_length * 0.6, -2, body_height / 2 + 6) * left_stalk

# Right eye stalk - mirrors the left
right_stalk_points = [
    (0, 0, 0),
    (-2, 4, 8),
    (-4, 7, 16),
    (-3, 9, stalk_length)
]
right_stalk_path = Spline(*right_stalk_points)
right_stalk_section = Plane(right_stalk_path ^ 0) * Circle(1.5)
right_stalk = sweep(right_stalk_section, path=right_stalk_path)
right_stalk = Pos(-body_length * 0.6, 2, body_height / 2 + 6) * right_stalk

# --- Build Eyes ---
left_eye_pos = (-body_length * 0.6 - 3, -2 - 9, body_height / 2 + 6 + stalk_length)
left_eye = Pos(*left_eye_pos) * Sphere(eye_radius)

right_eye_pos = (-body_length * 0.6 - 3, 2 + 9, body_height / 2 + 6 + stalk_length)
right_eye = Pos(*right_eye_pos) * Sphere(eye_radius)

# Eye pupils (small darker spheres offset forward)
left_pupil = Pos(left_eye_pos[0] - eye_radius * 0.5, left_eye_pos[1], left_eye_pos[2]) * Sphere(eye_radius * 0.45)
right_pupil = Pos(right_eye_pos[0] - eye_radius * 0.5, right_eye_pos[1], right_eye_pos[2]) * Sphere(eye_radius * 0.45)

# --- Build Lower Tentacles/Feelers ---
# These are the shorter sensory tentacles below the eyes
left_feeler_points = [
    (0, 0, 0),
    (-4, -2, -1),
    (-8, -4, -2),
    (-12, -5, -1)
]
left_feeler_path = Spline(*left_feeler_points)
left_feeler_section = Plane(left_feeler_path ^ 0) * Circle(0.8)
left_feeler = sweep(left_feeler_section, path=left_feeler_path)
left_feeler = Pos(-body_length * 0.7, -3, body_height / 2) * left_feeler

right_feeler_points = [
    (0, 0, 0),
    (-4, 2, -1),
    (-8, 4, -2),
    (-12, 5, -1)
]
right_feeler_path = Spline(*right_feeler_points)
right_feeler_section = Plane(right_feeler_path ^ 0) * Circle(0.8)
right_feeler = sweep(right_feeler_section, path=right_feeler_path)
right_feeler = Pos(-body_length * 0.7, 3, body_height / 2) * right_feeler

# --- Combine All Parts ---
# Use Compound to collect all parts (they don't all intersect, so union won't work)
all_parts = [
    shell,
    body,
    head,
    left_stalk,
    right_stalk,
    left_eye,
    right_eye,
    left_pupil,
    right_pupil,
    left_feeler,
    right_feeler
]
snail = Compound(all_parts)

# --- Validate ---
report = full_check(snail)
print(report)

# --- Export ---
script_name = Path(__file__).stem
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
steps_dir = Path("steps")
steps_dir.mkdir(exist_ok=True)
step_path = steps_dir / f"{script_name}_{timestamp}.step"
export_step(snail, str(step_path))
print(f"Exported: {step_path}")

# Export STL
stl_path = steps_dir / f"{script_name}_{timestamp}.stl"
export_stl(snail, str(stl_path))
print(f"Exported: {stl_path}")
