/**
 * Gradient Mesh Background
 *
 * A subtle, animated gradient mesh that adds depth and warmth to the dashboard.
 * Uses CSS animations for performance - no JavaScript required for the animation.
 */
export function GradientMesh() {
  return (
    <div className="dashboard-gradient-mesh" aria-hidden="true">
      <div className="gradient-orb" />
    </div>
  )
}
