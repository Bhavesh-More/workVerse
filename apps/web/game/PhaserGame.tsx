"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { NavigationTarget, WorldView } from "../lib/types";
import type { CompiledWorld } from "../lib/world/types";
import type { NavigationStatus } from "./navigation";

export type PhaserGameHandle = {
  travelTo: (locationId: string) => void;
  focusCharacter: (characterId: string) => void;
  setNavigationTarget: (target: NavigationTarget | null) => void;
  setNavigationVisible: (visible: boolean) => void;
};

type Props = {
  world: WorldView;
  sessionId: string;
  playerTexture?: string;
  onPrompt: (label: string | null) => void;
  onNearCharacter: (characterId: string | null) => void;
  onInteractCharacter: (characterId: string) => void;
  onVoiceCharacter: (characterId: string) => void;
  onInteractObject: (objectId: string) => void;
  onLocationChange: (locationId: string) => void;
  onNavigationStatus?: (status: NavigationStatus) => void;
  onReady: () => void;
  isLocked?: () => boolean;
  map?: CompiledWorld | null;
};

export const PhaserGame = forwardRef<PhaserGameHandle, Props>(function PhaserGame(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<unknown>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  useImperativeHandle(ref, () => ({
    travelTo: (locationId: string) => {
      const game = gameRef.current as { __scene?: () => { travelTo: (id: string) => void } } | null;
      game?.__scene?.().travelTo(locationId);
    },
    focusCharacter: (characterId: string) => {
      const game = gameRef.current as {
        __scene?: () => { focusCharacter: (id: string) => void };
      } | null;
      game?.__scene?.().focusCharacter(characterId);
    },
    setNavigationTarget: (target: NavigationTarget | null) => {
      const game = gameRef.current as {
        __scene?: () => { setNavigationTarget: (t: NavigationTarget | null) => void };
      } | null;
      game?.__scene?.().setNavigationTarget(target);
    },
    setNavigationVisible: (visible: boolean) => {
      const game = gameRef.current as {
        __scene?: () => { setNavigationVisible: (v: boolean) => void };
      } | null;
      game?.__scene?.().setNavigationVisible(visible);
    },
  }));

  useEffect(() => {
    let disposed = false;
    const parent = containerRef.current;
    if (!parent) return;

    (async () => {
      const { createOfficeGame } = await import("./office");
      const custom = callbacks.current.world.map;
      let map = callbacks.current.map ?? null;
      if (!map && custom) {
        // A company-built office frozen into this session: compile it for the engine.
        const [{ compileWorld }, { KIT }] = await Promise.all([import("../lib/world/compile"), import("../lib/world/kit")]);
        map = compileWorld(custom.doc, KIT, custom.members);
      }
      if (disposed) return;
      gameRef.current = createOfficeGame(parent, {
        world: callbacks.current.world,
        map,
        playerTexture: callbacks.current.playerTexture ?? "player",
        onPrompt: (label) => callbacks.current.onPrompt(label),
        onNearCharacter: (id) => callbacks.current.onNearCharacter(id),
        onInteractCharacter: (id) => callbacks.current.onInteractCharacter(id),
        onVoiceCharacter: (id) => callbacks.current.onVoiceCharacter(id),
        onInteractObject: (id) => callbacks.current.onInteractObject(id),
        onLocationChange: (id) => callbacks.current.onLocationChange(id),
        onNavigationStatus: (status) => callbacks.current.onNavigationStatus?.(status),
        onReady: () => callbacks.current.onReady(),
        isLocked: () => callbacks.current.isLocked?.() ?? false,
      });
    })();

    return () => {
      disposed = true;
      const game = gameRef.current as { destroy?: (removeCanvas: boolean) => void } | null;
      game?.destroy?.(true);
      gameRef.current = null;
    };
  }, [props.sessionId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} aria-label="Office game" />;
});
