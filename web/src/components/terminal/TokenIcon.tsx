import { useState } from "react";
import type { TokenInfo } from "../../lib/config";

/** Real token logo (see web/README.md for source); falls back to a
 * monogram ring only if the image genuinely fails to load. */
export function TokenIcon({ token, size = 28 }: { token: TokenInfo; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="flex flex-none items-center justify-center rounded-full border bg-panel"
        style={{ width: size, height: size, borderColor: token.tone, color: token.tone }}
      >
        <span className="mono" style={{ fontSize: size * 0.3 }}>
          {token.code.slice(0, 3)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={token.logo}
      alt={token.code}
      width={size}
      height={size}
      className="flex-none rounded-full"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
