'use client';

/**
 * GeofenceGlobe — globo 3D (Cesium) que plota as cercas de geofence como
 * ponto + círculo (raio real em metros). Mesmo motor do Insight Operations
 * 3D. Clicar numa cerca a seleciona; em `pickMode`, clicar no globo devolve
 * lat/lng (para posicionar uma nova cerca). Defensivo: se o Cesium falhar,
 * cai num fallback sem quebrar a página.
 */

import { useEffect, useRef, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import type { ProjectGeofence } from '@/lib/types/people';

const CESIUM_VERSION = '1.138.0';
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VERSION}/Build/Cesium/`;
const CESIUM_CSS = `${CESIUM_BASE}Widgets/widgets.css`;

function ensureCesiumCss() {
  if (typeof document === 'undefined' || document.getElementById('ig-cesium-css')) return;
  const link = document.createElement('link');
  link.id = 'ig-cesium-css';
  link.rel = 'stylesheet';
  link.href = CESIUM_CSS;
  document.head.appendChild(link);
}

interface GeofenceGlobeProps {
  geofences: ProjectGeofence[];
  selectedId?: string | null;
  pickMode?: boolean;
  onSelect?: (geofence: ProjectGeofence) => void;
  onPick?: (lat: number, lng: number) => void;
}

export function GeofenceGlobe({
  geofences,
  selectedId,
  pickMode = false,
  onSelect,
  onPick,
}: GeofenceGlobeProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cesiumRef = useRef<any>(null);
  const geofencesRef = useRef<ProjectGeofence[]>(geofences);
  const pickModeRef = useRef(pickMode);
  const onSelectRef = useRef(onSelect);
  const onPickRef = useRef(onPick);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  geofencesRef.current = geofences;
  pickModeRef.current = pickMode;
  onSelectRef.current = onSelect;
  onPickRef.current = onPick;

  // init viewer once
  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === 'undefined' || !containerRef.current) return;
      try {
        (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE;
        ensureCesiumCss();
        const Cesium = await import('cesium');
        if (cancelled || !containerRef.current) return;
        cesiumRef.current = Cesium;

        const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
        if (ionToken) Cesium.Ion.defaultAccessToken = ionToken;

        const imageryProvider = new Cesium.UrlTemplateImageryProvider({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
          maximumLevel: 19,
        });

        const viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: Cesium.ImageryLayer.fromProviderAsync(
            Promise.resolve(imageryProvider) as never,
            {},
          ),
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          selectionIndicator: false,
          infoBox: false,
          shouldAnimate: false,
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          requestRenderMode: true,
          maximumRenderTimeChange: 0.5,
        });
        viewerRef.current = viewer;

        viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(
          theme === 'dark' ? '#071116' : '#e8eef0',
        );
        viewer.scene.backgroundColor = Cesium.Color.TRANSPARENT;
        const credits = (viewer as unknown as { cesiumWidget: { creditContainer: HTMLElement } })
          .cesiumWidget.creditContainer;
        if (credits?.style) credits.style.display = 'none';

        // click handler: select fence or pick coordinate
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        handler.setInputAction((event: { position: { x: number; y: number } }) => {
          const picked = viewer.scene.pick(new Cesium.Cartesian2(event.position.x, event.position.y));
          const id = picked?.id?.id as string | undefined;
          if (id) {
            const gf = geofencesRef.current.find((g) => g.id === id);
            if (gf) {
              onSelectRef.current?.(gf);
              return;
            }
          }
          if (pickModeRef.current) {
            const cartesian = viewer.camera.pickEllipsoid(
              new Cesium.Cartesian2(event.position.x, event.position.y),
              viewer.scene.globe.ellipsoid,
            );
            if (cartesian) {
              const carto = Cesium.Cartographic.fromCartesian(cartesian);
              onPickRef.current?.(
                Cesium.Math.toDegrees(carto.latitude),
                Cesium.Math.toDegrees(carto.longitude),
              );
            }
          }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(-54.5, -14.2, 9_800_000),
        });

        if (!cancelled) {
          setReady(true);
          renderFences();
        }
      } catch (err) {
        console.warn('[GeofenceGlobe] Cesium indisponível', err);
        if (!cancelled) setFailed(true);
      }
    }

    void init();
    return () => {
      cancelled = true;
      try {
        viewerRef.current?.destroy?.();
      } catch {
        /* noop */
      }
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (re)render fence entities when data or selection changes
  function renderFences() {
    const Cesium = cesiumRef.current;
    const viewer = viewerRef.current;
    if (!Cesium || !viewer || viewer.isDestroyed?.()) return;

    viewer.entities.removeAll();
    const list = geofencesRef.current.filter((g) => Number.isFinite(g.centerLat) && Number.isFinite(g.centerLng));

    for (const g of list) {
      const active = g.active;
      const isSel = g.id === selectedId;
      const base = active ? '#22C08D' : '#8DA2B5';
      const color = Cesium.Color.fromCssColorString(base);
      viewer.entities.add({
        id: g.id,
        name: g.name,
        position: Cesium.Cartesian3.fromDegrees(g.centerLng, g.centerLat),
        point: {
          pixelSize: isSel ? 14 : 10,
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        ellipse: {
          semiMinorAxis: g.radiusMeters,
          semiMajorAxis: g.radiusMeters,
          material: color.withAlpha(isSel ? 0.35 : 0.2),
          outline: true,
          outlineColor: color.withAlpha(0.9),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: g.name,
          font: '600 12px "Inter", sans-serif',
          pixelOffset: new Cesium.Cartesian2(0, -20),
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#0C1116').withAlpha(0.75),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scale: isSel ? 1 : 0.85,
        },
      });
    }

    // fly to selected / bounds
    const target = list.find((g) => g.id === selectedId) ?? list[0];
    if (target) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          target.centerLng,
          target.centerLat,
          Math.max(target.radiusMeters * 12, 3000),
        ),
        duration: 1.2,
      });
    }
    viewer.scene.requestRender();
  }

  useEffect(() => {
    if (ready) renderFences();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geofences, selectedId, ready]);

  if (failed) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-xl border border-ig-border-subtle bg-ig-panel/60 text-center">
        <Globe2 className="h-8 w-8 text-ig-fg-muted" />
        <p className="text-sm text-ig-fg-muted">Globo indisponível — use o endereço ou a localização atual.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-xl border border-ig-border-subtle">
      <div ref={containerRef} className="h-full w-full" />
      {pickMode && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-ig-border-focus bg-ig-accent-weak px-3 py-1 text-xs font-medium text-ig-accent">
          Clique no globo para definir o centro da cerca
        </div>
      )}
    </div>
  );
}
