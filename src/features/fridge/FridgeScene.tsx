import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { useFridgeStore } from '../../store/fridgeStore';
import { ShelfUnit } from './ShelfUnit';
import { CabinetFrame } from './CabinetFrame';
import { ResponsiveCamera } from './ResponsiveCamera';

/** OrbitControls target가 변경될 때 동기화 (prop만으로는 갱신이 안 될 수 있음) */
function SyncOrbitTarget({ target }: { target: [number, number, number] }) {
    const { controls } = useThree();
    useEffect(() => {
        const orbit = controls as { target: { set: (x: number, y: number, z: number) => void }; update?: () => void } | null;
        if (orbit?.target) orbit.target.set(...target);
        if (typeof orbit?.update === 'function') orbit.update();
    }, [controls, target]);
    return null;
}

/** CabinetFrame과 동일 */
const SHELF_BOTTOM_Y = -0.25;
/** 선반 두께 (ShelfUnit SHELF_HEIGHT와 동일) */
const SHELF_HEIGHT = 0.2;

/** 정면 위 약 30도 각도 - 시약 배치 시 고정 시점 */
const PLACE_ELEVATION_DEG = 30; // 수평선 기준 위 30도
const PLACE_ELEVATION_RAD = PLACE_ELEVATION_DEG * (Math.PI / 180);

function useCabinetCamera(
    cabinetWidth: number,
    cabinetHeight: number,
    mode: 'VIEW' | 'EDIT' | 'PLACE'
) {
    const [aspect, setAspect] = useState(
        typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight - 112) : 0.6
    );

    useEffect(() => {
        const onResize = () => setAspect(window.innerWidth / Math.max(1, window.innerHeight - 112));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    return useMemo(() => {
        // FOV = 52. Math.tan(26 * PI/180) = 0.4877
        const fovFactor = 2 * Math.tan(26 * Math.PI / 180); // ~0.975

        // VIEW/EDIT/PLACE 모드 모두 하단 UI를 피하기 위해 화면 하단을 안전 영역으로 비워둠
        // 이전 45%에서 35%로 줄여서 캐비닛이 너무 위로 치우치지 않고 자연스럽게 위치하도록 조정
        const blockedRatio = 0.35;

        // 캐비닛 위아래 여유 공간 (줌아웃을 위해 여백 증가)
        const visibleHeightNeeded = cabinetHeight + 2.5;
        const totalVisibleHeight = visibleHeightNeeded / (1 - blockedRatio);

        // 화면 aspect(종횡비)를 고려하여 폭이 좁은 기기에서도 양옆이 잘리지 않도록 조정
        // 캐비닛 좌우 여유 공간 (줌아웃을 위해 여백 증가)
        const visibleWidthNeeded = cabinetWidth + 3.0;
        const distFromHeight = totalVisibleHeight / fovFactor;
        const distFromWidth = visibleWidthNeeded / (fovFactor * aspect);

        // 높이와 너비 중 더 먼 거리를 채택하여 전체가 다 보이도록 함
        const distance = Math.max(distFromHeight, distFromWidth);

        const minDistance = distance * 0.3;
        const maxDistance = distance * 2.5;

        // 캐비닛의 실제 중심 Y (바닥 기준값부터 높이 절반)
        // 카메라 전체 위치를 위로 올리기 위해 중심점을 임의로 더 높게 잡음 (예: + 1.0)
        const cabinetCenterY = SHELF_BOTTOM_Y + cabinetHeight / 2 + 1.2;

        // UI(35%)를 피해서 화면 상단 65% 영역의 중앙에 오도록 targetY 하향 조정
        const targetY = cabinetCenterY - (distance * fovFactor * blockedRatio / 2);
        const target: [number, number, number] = [0, targetY, 0];

        if (mode === 'PLACE') {
            // 배치 모드 초기 화면: 정면 위 30도에서 바라보는 고정 시점
            const posY = targetY + distance * Math.sin(PLACE_ELEVATION_RAD);
            const posZ = distance * Math.cos(PLACE_ELEVATION_RAD);
            return {
                position: [0, posY, posZ] as [number, number, number],
                minDistance,
                maxDistance,
                target,
                isPlaceMode: true,
                baseDistance: distance
            };
        }

        // VIEW / EDIT 모드: 약간 위(정면 5도)에서 내려다보아 전체적인 크기감이 자연스럽게 보이게 함
        // 기존 측면 오프셋 제거 및 정면 중심으로 배치
        const elevationRad = 5 * (Math.PI / 180);
        const posY = targetY + distance * Math.sin(elevationRad);
        const posZ = distance * Math.cos(elevationRad);

        return {
            position: [0, posY, posZ] as [number, number, number],
            minDistance,
            maxDistance,
            target,
            isPlaceMode: false,
            baseDistance: distance
        };
    }, [cabinetWidth, cabinetHeight, mode, aspect]);
}

export const FridgeScene: React.FC = () => {
    const shelves = useFridgeStore((state) => state.shelves);
    const mode = useFridgeStore((state) => state.mode);
    const draggedItem = useFridgeStore((state) => state.draggedItem);
    const setDraggedItem = useFridgeStore((state) => state.setDraggedItem);

    useEffect(() => {
        if (!draggedItem) return;
        const onPointerUp = () => {
            setDraggedItem(null);
            document.body.style.cursor = 'default';
        };
        window.addEventListener('pointerup', onPointerUp);
        return () => window.removeEventListener('pointerup', onPointerUp);
    }, [draggedItem, setDraggedItem]);
    const cabinetWidth = useFridgeStore((state) => state.cabinetWidth);
    const cabinetHeight = useFridgeStore((state) => state.cabinetHeight);
    const cabinetDepth = useFridgeStore((state) => state.cabinetDepth);

    const floorShelf = useMemo(() => shelves.find(s => s.level === 0 || s.id === 'floor'), [shelves]);
    const floatingShelves = useMemo(() => shelves.filter(s => s.level !== 0 && s.id !== 'floor'), [shelves]);

    /** 상하 패널·선반 두께를 고려하여 N+1칸 균등 분할 */
    const { getShelfY, cellHeight } = useMemo(() => {
        const count = floatingShelves.length;
        const bottom = SHELF_BOTTOM_Y + 0.02; // Align perfectly with floorShelf position
        const top = SHELF_BOTTOM_Y + cabinetHeight; // 상판 하단 = 실제 천장 (PANEL 제외)
        const usableHeight = top - bottom;
        if (count === 0) return { getShelfY: () => 0, cellHeight: usableHeight };
        const totalGap = usableHeight - count * SHELF_HEIGHT;
        const gapHeight = totalGap / (count + 1);
        const getY = (index: number) => bottom + (index + 1) * (gapHeight + SHELF_HEIGHT);
        return { getShelfY: getY, cellHeight: gapHeight };
    }, [floatingShelves.length, cabinetHeight]);

    const cameraConfig = useCabinetCamera(cabinetWidth, cabinetHeight, mode);
    const [shelfFocusTarget, setShelfFocusTarget] = useState<[number, number, number] | null>(null);
    const focusedShelfId = useFridgeStore((state) => state.focusedShelfId);
    const setFocusedShelfId = useFridgeStore((state) => state.setFocusedShelfId);
    const GROUP_OFFSET_Y = -0.5;

    const effectiveTarget = shelfFocusTarget ?? cameraConfig.target;
    const isPlaceMode = mode === 'PLACE';

    const handleShelfFocus = (shelfId: string, localY: number) => {
        if (mode === 'PLACE' && focusedShelfId === shelfId) {
            setShelfFocusTarget(null);
            setFocusedShelfId(null);
        } else {
            setShelfFocusTarget([0, GROUP_OFFSET_Y + localY, 0]);
            if (mode === 'PLACE') setFocusedShelfId(shelfId);
        }
    };

    // Auto-focus when navigated from search
    useEffect(() => {
        if (focusedShelfId && mode === 'VIEW') {
            const shelfIndex = floatingShelves.findIndex(s => s.id === focusedShelfId);
            if (shelfIndex !== -1) {
                setShelfFocusTarget([0, GROUP_OFFSET_Y + getShelfY(shelfIndex), 0]);
            } else if (floorShelf && focusedShelfId === floorShelf.id) {
                setShelfFocusTarget([0, GROUP_OFFSET_Y + (SHELF_BOTTOM_Y + 0.02), 0]);
            }
        }
    }, [focusedShelfId, mode, floatingShelves, floorShelf, getShelfY]);

    // highlightedItemId is managed externally (App.tsx sets it, user interaction clears it)

    /** 선반/바닥 클릭 시 해당 타겟을 기준 정면 30도 카메라 및 줌인 (VIEW/EDIT/PLACE 공통) */
    const effectiveCameraConfig = useMemo(() => {
        if (shelfFocusTarget != null) {
            // 특정 선반을 클릭했을 때 거리를 좁혀(dist) 자세히 보이게 조정
            const dist = isPlaceMode ? cameraConfig.baseDistance * 0.8 : cameraConfig.baseDistance * 0.6;
            const fovFactor = 2 * Math.tan(26 * Math.PI / 180);
            const visibleHeight = dist * fovFactor;

            // 줌인 상태에서도 하단 UI(45%)에 가리지 않도록 
            // 대상(shelfFocusTarget)을 화면 중앙보다 15% 위쪽에 렌더링하도록 타겟을 하향 조정
            const yOffset = visibleHeight * 0.15;
            const targetY = shelfFocusTarget[1] - yOffset;

            const posY = targetY + dist * Math.sin(PLACE_ELEVATION_RAD);
            const posZ = dist * Math.cos(PLACE_ELEVATION_RAD);

            return {
                ...cameraConfig,
                position: [0, posY, posZ] as [number, number, number],
                target: [0, targetY, 0] as [number, number, number],
            };
        }
        return { ...cameraConfig, target: effectiveTarget };
    }, [shelfFocusTarget, effectiveTarget, cameraConfig, isPlaceMode]);

    return (
        <div className="w-full bg-gray-100 relative" style={{ height: 'calc(100dvh - 7rem)' }}>
            <Canvas
                shadows="soft"
                camera={{ position: cameraConfig.position, fov: 52 }}
                gl={{ preserveDrawingBuffer: true }}
            >
                <Suspense fallback={null}>
                    <ResponsiveCamera
                        cabinetWidth={cabinetWidth}
                        cabinetHeight={cabinetHeight}
                        config={effectiveCameraConfig}
                    />
                    <Environment preset="city" />
                    <ambientLight intensity={0.5} />
                    <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} shadow-mapSize={[512, 512]} castShadow />

                    <group position={[0, -0.5, 0]}>
                        <CabinetFrame
                            width={cabinetWidth}
                            depth={cabinetDepth}
                            cabinetHeight={cabinetHeight}
                            dimmed={isPlaceMode && focusedShelfId != null}
                        />
                        {/* 바닥면 (floor shelf) */}
                        {floorShelf && (
                            <ShelfUnit
                                key={floorShelf.id}
                                shelf={floorShelf}
                                position={[0, SHELF_BOTTOM_Y + 0.02, 0]}
                                shelfWidth={cabinetWidth}
                                shelfDepth={cabinetDepth}
                                cellHeight={cellHeight} // Use unified cellHeight or separate?
                                onShelfFocus={(localY) => handleShelfFocus(floorShelf.id, localY)}
                                shelfHeight={0.05}
                                isDimmed={isPlaceMode && focusedShelfId != null && floorShelf.id !== focusedShelfId}
                            />
                        )}

                        {/* 띄워진 선반들 */}
                        {floatingShelves.map((shelf, index) => (
                            <ShelfUnit
                                key={shelf.id}
                                shelf={shelf}
                                position={[0, getShelfY(index), 0]}
                                shelfWidth={cabinetWidth}
                                shelfDepth={cabinetDepth}
                                cellHeight={cellHeight}
                                onShelfFocus={(localY) => handleShelfFocus(shelf.id, localY)}
                                isDimmed={isPlaceMode && focusedShelfId != null && shelf.id !== focusedShelfId}
                            />
                        ))}

                    </group>

                    <ContactShadows position={[0, -1, 0]} opacity={0.4} scale={10} blur={2.5} far={4} />
                    <OrbitControls
                        makeDefault
                        minPolarAngle={Math.PI / 6}
                        maxPolarAngle={Math.PI / 2}
                        minDistance={cameraConfig.minDistance}
                        maxDistance={cameraConfig.maxDistance}
                        target={effectiveTarget}
                        enableRotate={!isPlaceMode && !draggedItem}
                        enablePan={!isPlaceMode && !draggedItem}
                        enableZoom={true}
                    />
                    <SyncOrbitTarget target={effectiveTarget} />
                </Suspense>
            </Canvas>
        </div>
    );
};
