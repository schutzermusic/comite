const elevations = [1, 2, 3, 4, 5] as const;

type Elevation = (typeof elevations)[number];
type StatePanel = {
  elevation: Elevation;
  label: string;
  focused?: boolean;
  state?: 'warning' | 'critical';
  sweep?: boolean;
};

const statePanels: StatePanel[] = [
  { elevation: 1, label: 'DEFAULT' },
  { elevation: 2, label: 'SWEEP', sweep: true },
  { elevation: 3, label: 'FOCUSED', focused: true },
  { elevation: 4, label: 'WARNING', state: 'warning' },
  { elevation: 5, label: 'CRITICAL', state: 'critical', sweep: true },
];

export default function Preview() {
  return (
    <div className="min-h-screen bg-ig-canvas p-10 text-ig-fg">
      <div className="mb-8">
        <p className="text-ig-label ig-label-upper text-ig-fg-muted">Material system</p>
        <h1 className="mt-2 text-ig-h1 ig-text-metal">IG Glass Preview</h1>
      </div>

      <div className="grid grid-cols-2 gap-6 lg:grid-cols-5">
        {elevations.map((e) => (
          <div
            key={e}
            className="ig-glass"
            data-elev={e}
            data-interactive=""
            data-sweep=""
          >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <span data-ig-sweep="" />
            <div data-ig-content="" className="p-5">
              <p className="mb-1 text-ig-label ig-label-upper text-ig-fg-muted">ELEV {e}</p>
              <p className="text-ig-h3 text-ig-fg-strong">Glass Panel</p>
              <p className="mt-1 text-ig-body-sm text-ig-fg-muted">
                Profundidade e blur elevação {e}.
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-5">
        {statePanels.map((panel) => (
          <div
            key={panel.label}
            className="ig-glass"
            data-elev={panel.elevation}
            data-focused={panel.focused ? '' : undefined}
            data-interactive=""
            data-state={panel.state}
            data-sweep={panel.sweep ? '' : undefined}
          >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            {panel.sweep ? <span data-ig-sweep="" /> : null}
            <div data-ig-content="" className="p-5">
              <p className="mb-1 text-ig-label ig-label-upper text-ig-fg-muted">{panel.label}</p>
              <p className="text-ig-h3 text-ig-fg-strong">State Panel</p>
              <p className="mt-1 text-ig-body-sm text-ig-fg-muted">
                Elevação {panel.elevation} com estado visual.
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
