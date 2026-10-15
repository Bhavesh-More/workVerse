// Server-safe placeholders shaped like the real layouts, so nothing jumps when data lands.

export function PageSkeleton() {
  return (
    <main className="app-main" aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 14, width: 120, borderRadius: 8, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 48, maxWidth: 520, marginBottom: 40 }} />
      <div className="grid-3" style={{ marginBottom: 24 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 140 }} />
        ))}
      </div>
      <div className="grid-2">
        <div className="skeleton" style={{ height: 220 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    </main>
  );
}

export function SimSkeleton() {
  return (
    <div className="sim-full" aria-busy="true" aria-label="Opening the office">
      <div className="sim-full__bar">
        <div className="skeleton" style={{ height: 34, width: 240, borderRadius: 8 }} />
        <div className="skeleton" style={{ height: 32, width: 300, borderRadius: 8 }} />
      </div>
      <div className="sim-full__body">
        <div className="sim-full__game">
          <div className="game-loading">
            <span className="mono busy-dots">Opening the office</span>
          </div>
        </div>
        <div className="sim-full__side">
          <div className="skeleton" style={{ height: 180 }} />
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      </div>
    </div>
  );
}
