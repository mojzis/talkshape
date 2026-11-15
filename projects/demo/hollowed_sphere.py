from build123d import *
from b3d_validate import full_check
from datetime import datetime
from pathlib import Path

# --- Parameters ---
sphere_radius = 30
cylinder_radius = 10
cylinder_height = sphere_radius * 2 + 10  # Ensure it goes through completely

# --- Build ---
# Create sphere and hollow it with a cylinder through the center
part = Sphere(sphere_radius)
part -= Cylinder(cylinder_radius, cylinder_height)

# --- Validate ---
report = full_check(part)
print(report)

# --- Export ---
script_name = Path(__file__).stem
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

# Export STEP
steps_dir = Path("steps")
steps_dir.mkdir(exist_ok=True)
step_path = steps_dir / f"{script_name}_{timestamp}.step"
export_step(part, str(step_path))
print(f"Exported STEP: {step_path}")

# Export STL
stls_dir = Path("stls")
stls_dir.mkdir(exist_ok=True)
stl_path = stls_dir / f"{script_name}_{timestamp}.stl"
export_stl(part, str(stl_path))
print(f"Exported STL: {stl_path}")
