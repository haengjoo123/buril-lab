import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import { useFridgeStore } from '../../store/fridgeStore';
import { ShelfUnit } from './ShelfUnit';
import { CabinetFrame } from './CabinetFrame';
import { Divider } from './Divider';
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

const REF_WIDTH = 10;
const REF_HEIGHT = 2.75;
/** CabinetFrame과 동일 */
const SHELF_BOTTOM_Y = -0.25;
const CABINET_WALL = 0.12;
/** 상하 패널 두께 (CabinetFrame WALL과 동일) */
const PANEL_THICKNESS = CABINET_WALL;
/** 선반 두께 (ShelfUnit SHELF_HEIGHT와 동일) */
const SHELF_HEIGHT = 0.2;

/** 정면 위 약 30도 각도 - 시약 배치 시 고정 시점 */
const PLACE_ELEVATION_DEG = 30; // 수평선 기준 위 30도
const PLACE_ELEVATION_RAD = PLACE_ELEVATION_DEG * (Math.PI / 180);

/** PLACE 모드에서 타겟(선반/바닥) 클릭 시 카메라를 정면 정렬 + 고정 각도로 배치 */
function getPlaceModeCameraForTarget(
    target: [number, number, number],
    cabinetWidth: number,
    cabinetHeight: number
) {
    const sizeFactor = Math.max(cabinetWidth / REF_WIDTH, cabinetHeight / REF_HEIGHT);
    const dist = 5 + sizeFactor * 1.2;
    const xOffset = 0.4 * (cabinetWidth / REF_WIDTH); // 정면에 가깝게
    const targetY = target[1];
    // 정면(축) 위 30도: target에서 앞(+Z) 위(+Y) 방향으로 dist만큼
    const posY = targetY + dist * Math.sin(PLACE_ELEVATION_RAD);
    const posZ = dist * Math.cos(PLACE_ELEVATION_RAD);
    return {
        position: [xOffset, posY, posZ] as [number, number, number],
        target: [0, targetY, 0] as [number, number, number],
    };
}

function useCabinetCamera(
    cabinetWidth: number,
    cabinetHeight: number,
    mode: 'VIEW' | 'EDIT' | 'PLACE'
) {
    return useMemo(() => {
        const sizeFactor = Math.max(cabinetWidth / REF_WIDTH, cabinetHeight / REF_HEIGHT);
        const distance = 7 + sizeFactor * 1.8;
        const minDistance = 4 + sizeFactor * 1.5;
        const maxDistance = 8 + sizeFactor * 4;
        const targetY = cabinetHeight * 0.35 - 0.75;
        const target: [number, number, number] = [0, targetY, 0];

        if (mode === 'PLACE') {
            // 기본 타겟을 아래쪽(25%)으로 - 가장 아래 칸이 보이도록
            const placeTargetY = cabinetHeight * 0.25 - 0.75;
            const placeTarget: [number, number, number] = [0, placeTargetY, 0];
            const place = getPlaceModeCameraForTarget(placeTarget, cabinetWidth, cabinetHeight);
            return {
                position: place.position,
                minDistance,
                maxDistance,
                target: place.target,
                isPlaceMode: true,
            };
        }

        const xOffset = 2.8 * (cabinetWidth / REF_WIDTH);
        const yOffset = targetY + 0.4;
        const posZ = Math.sqrt(Math.max(1, distance * distance - xOffset * xOffset - (yOffset - targetY) ** 2));
        return {
            position: [xOffset, yOffset, posZ] as [number, number, number],
            minDistance,
            maxDistance,
            target,
            isPlaceMode: false,
        };
    }, [cabinetWidth, cabinetHeight, mode]);
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

    const floorShelf = useMemo(() => shelves.find(s => s.id === 'floor'), [shelves]);
    const floatingShelves = useMemo(() => shelves.filter(s => s.id !== 'floor'), [shelves]);

    /** 상하 패널·선반 두께를 고려하여 N+1칸 균등 분할
     *  innerBottom: 하판 위(첫 칸 바닥), innerTop: 상판 하단(실제 천장)
     */
    const { getShelfY, cellHeight, innerBottom, innerTop } = useMemo(() => {
        const count = floatingShelves.length;
        const bottom = SHELF_BOTTOM_Y + PANEL_THICKNESS;
        const top = SHELF_BOTTOM_Y + cabinetHeight; // 상판 하단 = 실제 천장 (PANEL 제외)
        const usableHeight = top - bottom;
        if (count === 0) return { getShelfY: () => 0, cellHeight: 0.6, innerBottom: bottom, innerTop: top };
        const totalGap = usableHeight - count * SHELF_HEIGHT;
        const gapHeight = totalGap / (count + 1);
        const getY = (index: number) => bottom + (index + 1) * (gapHeight + SHELF_HEIGHT);
        return { getShelfY: getY, cellHeight: gapHeight, innerBottom: bottom, innerTop: top };
    }, [floatingShelves.length, cabinetHeight]);

    const cameraConfig = useCabinetCamera(cabinetWidth, cabinetHeight, mode);
    const [shelfFocusTarget, setShelfFocusTarget] = useState<[number, number, number] | null>(null);
    const focusedShelfId = useFridgeStore((state) => state.focusedShelfId);
    const setFocusedShelfId = useFridgeStore((state) => state.setFocusedShelfId);
    const GROUP_OFFSET_Y = -0.5;

    const effectiveTarget = shelfFocusTarget ?? cameraConfig.target;
    const isPlaceMode = mode === 'PLACE';

    /** 선반/바닥 클릭 시 해당 타겟 기준 정면 30도 카메라 (VIEW/EDIT/PLACE 공통) */
    const effectiveCameraConfig = useMemo(() => {
        if (shelfFocusTarget != null) {
            const place = getPlaceModeCameraForTarget(effectiveTarget, cabinetWidth, cabinetHeight);
            return {
                ...cameraConfig,
                position: place.position,
                target: place.target,
            };
        }
        return { ...cameraConfig, target: effectiveTarget };
    }, [shelfFocusTarget, effectiveTarget, cameraConfig, cabinetWidth, cabinetHeight]);

    const handleShelfFocus = (shelfId: string, localY: number) => {
        if (mode === 'PLACE' && focusedShelfId === shelfId) {
            setShelfFocusTarget(null);
            setFocusedShelfId(null);
        } else {
            setShelfFocusTarget([0, GROUP_OFFSET_Y + localY, 0]);
            if (mode === 'PLACE') setFocusedShelfId(shelfId);
        }
    };

    // For dividers, use any shelf available as reference since vertical panels are synced
    const referenceShelf = floatingShelves[0] || floorShelf;

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
                        {/* 가장 아래 칸(하판 위~첫 선반 하단) 구분막 */}
                        {referenceShelf && referenceShelf.dividers.map((pos, index) => (
                            <group key={`bottom-div-${index}`} position={[0, innerBottom, 0]}>
                                <Divider
                                    position={pos}
                                    shelfWidth={cabinetWidth}
                                    shelfDepth={cabinetDepth}
                                    height={cellHeight}
                                    dimmed={isPlaceMode && focusedShelfId != null}
                                />
                            </group>
                        ))}

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

                        {/* 가장 위 칸(마지막 선반 상단~상판 아래) 구분막 */}
                        {referenceShelf && referenceShelf.dividers.map((pos, index) => (
                            <group key={`top-div-${index}`} position={[0, getShelfY(floatingShelves.length - 1), 0]}>
                                <Divider
                                    position={pos}
                                    shelfWidth={cabinetWidth}
                                    shelfDepth={cabinetDepth}
                                    height={cellHeight}
                                    dimmed={isPlaceMode && focusedShelfId != null}
                                />
                            </group>
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
                        enableRotate={!isPlaceMode}
                        enablePan={!isPlaceMode}
                        enableZoom={true}
                    />
                    <SyncOrbitTarget target={effectiveTarget} />
                </Suspense>
            </Canvas>
        </div>
    );
};
