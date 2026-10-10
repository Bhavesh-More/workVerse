"use client";

import { useState } from "react";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function Avatar({
  imageUrl,
  name,
  size = 36,
}: {
  imageUrl?: string | null;
  name: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (imageUrl && !broken) {
    // Clerk-hosted avatar image; rendered with our own markup rather than a prebuilt component.
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        className="avatar"
        style={style}
        src={imageUrl}
        alt={name}
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="avatar avatar--fallback" style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
