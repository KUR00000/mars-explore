import { useEffect, useRef, useState } from 'react';

const INITIAL_TELEMETRY = {
  altitude: 0,
  fps: 0,
  heading: 0,
  lat: 0,
  lon: 0,
  pointerLocked: false,
  ready: false,
  speed: 0,
};

function formatDegrees(value, positive, negative) {
  const absolute = Math.abs(value).toFixed(1);
  const suffix = value >= 0 ? positive : negative;
  return `${absolute}°${suffix}`;
}

export default function App() {
  const mountRef = useRef(null);
  const minimapRef = useRef(null);
  const explorerRef = useRef(null);

  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [status, setStatus] = useState({
    message: 'Loading NASA topography.',
    source: 'Requesting Mars basemap and elevation data.',
  });

  useEffect(() => {
    if (!mountRef.current || !minimapRef.current) {
      return undefined;
    }

    let cancelled = false;

    import('./lib/marsExplorer.js')
      .then(({ createMarsExplorer }) => {
        if (cancelled || !mountRef.current || !minimapRef.current) {
          return;
        }

        const explorer = createMarsExplorer({
          minimapCanvas: minimapRef.current,
          mount: mountRef.current,
          onStatus: setStatus,
          onTelemetry: (next) => {
            setTelemetry((current) => ({ ...current, ...next }));
          },
        });

        explorerRef.current = explorer;
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({
            message: 'Scene failed to load.',
            source: 'Check the browser console for module or WebGL errors.',
          });
        }
      });

    return () => {
      cancelled = true;
      explorerRef.current?.destroy();
      explorerRef.current = null;
    };
  }, []);

  return (
    <main
      className={`app-shell${telemetry.pointerLocked ? ' is-exploring' : ''}`}
    >
      <div className="scene-layer" ref={mountRef} />

      <section className="hud hud-top">
        <div className="panel hero-panel">
          <p className="eyebrow">NASA Mars Terrain Explorer</p>
          <h1>Traverse the Tharsis rise and Valles Marineris in real time.</h1>
          <p className="lede">
            Three.js renders a first-person rover-style pass over official NASA
            Mars topography with live terrain-following movement, a minimap, and
            atmospheric lighting.
          </p>
          <div className="status-row">
            <span className="status-pill">{status.message}</span>
            <span className="status-note">{status.source}</span>
          </div>
        </div>

        <div className="panel stats-panel">
          <div className="stat">
            <span className="stat-label">Altitude</span>
            <strong>{telemetry.altitude.toFixed(1)} m</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Speed</span>
            <strong>{telemetry.speed.toFixed(1)} m/s</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Heading</span>
            <strong>{telemetry.heading.toFixed(0)}°</strong>
          </div>
          <div className="stat">
            <span className="stat-label">FPS</span>
            <strong>{telemetry.fps.toFixed(0)}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Latitude</span>
            <strong>{formatDegrees(telemetry.lat, 'N', 'S')}</strong>
          </div>
          <div className="stat">
            <span className="stat-label">Longitude</span>
            <strong>{formatDegrees(telemetry.lon, 'E', 'W')}</strong>
          </div>
        </div>
      </section>

      <section className="hud hud-bottom">
        <div className="panel controls-panel">
          <p className="eyebrow">Controls</p>
          <p>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> move
          </p>
          <p>
            <kbd>Shift</kbd> sprint
          </p>
          <p>
            <kbd>R</kbd> reset position
          </p>
          <p>Move the mouse to look around after locking the cursor.</p>
        </div>

        <div className="panel minimap-panel">
          <div className="minimap-header">
            <div>
              <p className="eyebrow">Survey Map</p>
              <p className="minimap-caption">
                NASA/JPL/GSFC MOLA topography, focused on the Tharsis-Valles
                corridor.
              </p>
            </div>
            <span className="status-dot" data-ready={telemetry.ready} />
          </div>
          <canvas
            aria-label="Mars minimap"
            className="minimap-canvas"
            ref={minimapRef}
          />
        </div>
      </section>

      <button
        className={`launch-button${telemetry.pointerLocked ? ' hidden' : ''}`}
        onClick={() => explorerRef.current?.lockPointer()}
        type="button"
      >
        Enter Explorer Mode
      </button>
    </main>
  );
}
