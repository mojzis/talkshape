from build123d import *
from b3d_validate import full_check
from datetime import datetime
from pathlib import Path

# --- Parameters ---
# Main cylinder (horizontal, along X axis)
cylinder_radius = 20
cylinder_length = 80

# Wheels
wheel_radius = 12
wheel_thickness = 8
wheel_offset_x = 25  # distance from center along X
wheel_y_offset = 18  # distance from center along Y (wider than cylinder)

# Cube on top
cube_size = 25

# --- Build ---
# Create horizontal cylinder (rotated to lie along X axis)
main_cylinder = Rot(0, 90, 0) * Cylinder(cylinder_radius, cylinder_length)

# Create 4 wheels positioned at corners beneath the cylinder
# Wheels are oriented with their flat sides facing outward (along Y axis)
wheel = Rot(90, 0, 0) * Cylinder(wheel_radius, wheel_thickness)

# Position wheels at 4 corners
wheel_z = -cylinder_radius  # bottom of cylinder
wheel_positions = [
    Pos(wheel_offset_x, wheel_y_offset + wheel_thickness/2, wheel_z),
    Pos(wheel_offset_x, -wheel_y_offset - wheel_thickness/2, wheel_z),
    Pos(-wheel_offset_x, wheel_y_offset + wheel_thickness/2, wheel_z),
    Pos(-wheel_offset_x, -wheel_y_offset - wheel_thickness/2, wheel_z),
]

wheels = [pos * wheel for pos in wheel_positions]

# Create cube on top of the cylinder
cube_z = cylinder_radius + cube_size / 2  # sitting on top of cylinder
cube = Pos(0, 0, cube_z) * Box(cube_size, cube_size, cube_size)

# Combine all parts
part = main_cylinder + cube
for w in wheels:
    part += w

# --- Validate ---
report = full_check(part)
print(report)

# --- Export ---
script_name = Path(__file__).stem
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
steps_dir = Path("steps")
steps_dir.mkdir(exist_ok=True)
step_path = steps_dir / f"{script_name}_{timestamp}.step"
export_step(part, str(step_path))
print(f"Exported: {step_path}")

# Export STL
stl_path = steps_dir / f"{script_name}_{timestamp}.stl"
export_stl(part, str(stl_path))
print(f"Exported: {stl_path}")
