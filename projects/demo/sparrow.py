"""
Sparrow 3D Model - Built from decomposed parts

Parts breakdown:
1. Body - Main ellipsoid (scaled sphere)
2. Head - Sphere, positioned forward and up
3. Tail - Wedge shape pointing backward
4. Wing - Flattened ellipsoid (one on each side)
5. Beak - Cone
6. Eye - Small sphere indentation
7. Legs - Thin cylinders with 3 toes each
"""

from build123d import *
from b3d_validate import full_check
from datetime import datetime
from pathlib import Path

# --- Parameters (in mm) ---
# Overall scale factor
model_scale = 1.0

# Body dimensions
body_length = 45 * model_scale      # X axis (front-back)
body_width = 28 * model_scale       # Y axis (side-side)
body_height = 26 * model_scale      # Z axis (top-bottom)

# Head dimensions
head_radius = 12 * model_scale      # Smaller head
head_offset_x = 28 * model_scale    # Forward from body center
head_offset_z = 8 * model_scale     # Up from body center

# Tail dimensions
tail_length = 30 * model_scale
tail_base_width = 18 * model_scale   # Wider to match body
tail_base_height = 14 * model_scale

# Wing dimensions
wing_length = 30 * model_scale
wing_width = 4 * model_scale
wing_height = 14 * model_scale
wing_offset_y = 10 * model_scale    # Side offset
wing_offset_z = 3 * model_scale     # Slight up

# Beak dimensions - proportional to smaller head
beak_length = 18 * model_scale
beak_radius = 5 * model_scale

# Leg dimensions
leg_radius = 1.8 * model_scale
leg_length = 22 * model_scale
toe_length = 7 * model_scale
leg_spacing = 12 * model_scale


# --- Helper Functions ---

def make_body():
    """Main body - ellipsoid shape using loft."""
    # Create ellipsoid by lofting ellipses at different X positions
    sections = []
    num_sections = 7

    for i in range(num_sections):
        t = i / (num_sections - 1)  # 0 to 1
        x = -body_length/2 + t * body_length

        # Ellipse size varies - largest at center
        # Using sine curve for smooth taper
        import math
        size_factor = math.sin(t * math.pi)
        ry = (body_width/2) * max(size_factor, 0.1)
        rz = (body_height/2) * max(size_factor, 0.1)

        section = Pos(x, 0, 0) * Rot(0, 90, 0) * Ellipse(rz, ry)
        sections.append(section)

    body = loft(sections)
    return body


def make_head():
    """Head - sphere positioned forward and up."""
    head = Sphere(head_radius)
    head = Pos(head_offset_x, 0, head_offset_z) * head
    return head


def make_tail():
    """Tail - tapered wedge using loft, blending smoothly from body."""
    # Base section INSIDE the body for smooth blend
    # Body tapers at the back, so match that shape
    base = Pos(-body_length/2 + 8, 0, 0) * Rot(0, 90, 0) * Ellipse(tail_base_height/2, tail_base_width/2)

    # Transition section - narrowing
    trans = Pos(-body_length/2, 0, -1) * Rot(0, 90, 0) * Ellipse(tail_base_height/2.5, tail_base_width/3)

    # Middle section - continuing to narrow
    mid = Pos(-body_length/2 - tail_length/3, 0, -2) * Rot(0, 90, 0) * Ellipse(tail_base_height/3.5, tail_base_width/5)

    # Tip (flat, fan-like)
    tip = Pos(-body_length/2 - tail_length, 0, -3) * Rot(0, 90, 0) * Ellipse(tail_base_height/6, tail_base_width/8)

    tail = loft([base, trans, mid, tip])
    return tail


def make_wing(side=1):
    """Wing - flattened ellipsoid using loft. side=1 for right, -1 for left."""
    import math

    sections = []
    num_sections = 5

    for i in range(num_sections):
        t = i / (num_sections - 1)
        y = side * (wing_offset_y + t * (wing_width - 1))

        # Wing shape tapers toward the outside
        size_factor = 1.0 - 0.3 * t
        rx = (wing_length/2) * size_factor
        rz = (wing_height/2) * size_factor

        section = Pos(-3, y, wing_offset_z) * Rot(90, 0, -8) * Ellipse(rx, rz)
        sections.append(section)

    wing = loft(sections)
    return wing


def make_beak():
    """Beak - cone shape pointing forward (+X direction)."""
    # Cone: base radius, tip radius, height
    # align MIN means base is at z=0, tip at z=height
    # Rot(0, 90, 0) rotates +90° around Y, so +Z becomes +X (forward)
    beak = Cone(beak_radius, 0.5, beak_length, align=(Align.CENTER, Align.CENTER, Align.MIN))

    # Place beak base inside head so they overlap and fuse properly
    beak_start_x = head_offset_x + head_radius - 4  # Inside head by 4mm
    beak = Pos(beak_start_x, 0, head_offset_z - 2) * Rot(0, 90, 0) * beak
    return beak


def make_eye(side=1):
    """Eye - small sphere indent. side=1 for right, -1 for left."""
    eye = Sphere(2.5 * model_scale)
    # Position on head - adjusted for smaller head
    eye = Pos(head_offset_x + 6, side * 9, head_offset_z + 3) * eye
    return eye


def make_leg(side=1):
    """Leg with 3 toes. side=1 for right, -1 for left."""
    # Main leg segment - vertical
    # Legs are side-by-side (Y-axis offset), not front-to-back
    leg = Cylinder(leg_radius, leg_length, align=(Align.CENTER, Align.CENTER, Align.MAX))
    leg_y = side * leg_spacing/2
    leg = Pos(0, leg_y, -body_height/2 + 2) * leg

    # Foot position (bottom of leg)
    foot_z = -body_height/2 + 2 - leg_length
    foot_y = leg_y

    # Front toe
    toe1 = Cylinder(leg_radius * 0.7, toe_length, align=(Align.CENTER, Align.CENTER, Align.MIN))
    toe1 = Pos(0, foot_y, foot_z) * Rot(0, 70, 0) * toe1

    # Right front toe
    toe2 = Cylinder(leg_radius * 0.7, toe_length * 0.85, align=(Align.CENTER, Align.CENTER, Align.MIN))
    toe2 = Pos(0, foot_y, foot_z) * Rot(0, 70, 35) * toe2

    # Left front toe
    toe3 = Cylinder(leg_radius * 0.7, toe_length * 0.85, align=(Align.CENTER, Align.CENTER, Align.MIN))
    toe3 = Pos(0, foot_y, foot_z) * Rot(0, 70, -35) * toe3

    # Back toe
    toe4 = Cylinder(leg_radius * 0.7, toe_length * 0.7, align=(Align.CENTER, Align.CENTER, Align.MIN))
    toe4 = Pos(0, foot_y, foot_z) * Rot(0, 110, 180) * toe4

    return leg + toe1 + toe2 + toe3 + toe4


# --- Build the Sparrow ---

print("Building sparrow parts...")

# Create main body parts
body = make_body()
print("  Body done")

head = make_head()
print("  Head done")

tail = make_tail()
print("  Tail done")

# Combine main body, head, and tail
sparrow = body + head + tail
print("  Main body assembled")

# Add wings
right_wing = make_wing(side=1)
left_wing = make_wing(side=-1)
sparrow = sparrow + right_wing + left_wing
print("  Wings added")

# Add beak
beak = make_beak()
sparrow = sparrow + beak
print("  Beak added")

# Add legs
right_leg = make_leg(side=1)
left_leg = make_leg(side=-1)
sparrow = sparrow + right_leg + left_leg
print("  Legs added")

# Create eye sockets (subtract small spheres)
right_eye = make_eye(side=1)
left_eye = make_eye(side=-1)
sparrow = sparrow - right_eye - left_eye
print("  Eyes carved")

# Rotate whole model -90° around Z so sparrow faces +Y direction
# This makes: Right view = side profile, Front = front of bird, Top = top-down
sparrow = Rot(0, 0, -90) * sparrow
print("  Rotated to standard orientation")

print("Sparrow assembly complete!")

# --- Validate ---
print("\nValidating geometry...")
report = full_check(sparrow)
print(report)

# --- Export ---
script_name = Path(__file__).stem
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
steps_dir = Path("steps")
steps_dir.mkdir(exist_ok=True)
step_path = steps_dir / f"{script_name}_{timestamp}.step"
stl_path = steps_dir / f"{script_name}_{timestamp}.stl"
export_step(sparrow, str(step_path))
export_stl(sparrow, str(stl_path))
print(f"Exported: {step_path}")
print(f"Exported: {stl_path}")
