import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { ReagentPlacement } from '../../types/fridge';
import { useSpring, animated } from '@react-spring/three';
import { useFridgeStore } from '../../store/fridgeStore';
import * as THREE from 'three';

interface ReagentItemProps {
    item: ReagentPlacement;
    shelfWidth: number;
    shelfDepth?: number;
    isGhost?: boolean;
    isValid?: boolean;
    /** PLACE 모드에서 비선택 선반의 시약 비활성화 시각 처리 */
    dimmed?: boolean;
}

export const CONTAINER_BASE_WIDTHS: Record<string, number> = { A: 8, B: 10, C: 9, D: 15 };

export const ItemGeometry: React.FC<{ type: string; defaultColor: string; opacity?: number; scale?: number; isHighlighted?: boolean }> = ({ type, defaultColor, opacity = 1, scale = 1, isHighlighted = false }) => {

    const materialRef = useRef<THREE.MeshStandardMaterial>(null);
    const highlightColor = useMemo(() => new THREE.Color('#ffff00'), []);
    const baseColor = useMemo(() => new THREE.Color(defaultColor), [defaultColor]);

    useFrame((state) => {
        if (!materialRef.current) return;
        if (isHighlighted) {
            const t = state.clock.elapsedTime;
            // Sine wave between 0 and 0.8 intensity for smooth pulsing
            const intensity = (Math.sin(t * 8) + 1) * 0.4;
            materialRef.current.emissive = highlightColor;
            materialRef.current.emissiveIntensity = intensity;
            materialRef.current.color = highlightColor;
        } else {
            materialRef.current.emissiveIntensity = 0;
            materialRef.current.color = baseColor;
        }
    });

    const materialProps = {
        transparent: opacity < 1,
        opacity,
        roughness: 0.3,
        metalness: 0.1,
        color: defaultColor
    };

    switch (type) {
        case 'A': // 갈색 병: 원기둥 몸통 + 좁은 목 + 뚜껑
            return (
                <group scale={scale}>
                    {/* 몸통 (갈색 원기둥) */}
                    <mesh castShadow position={[0, 0.35, 0]}>
                        <cylinderGeometry args={[0.22, 0.24, 0.7, 16]} />
                        <meshStandardMaterial ref={materialRef} {...materialProps} />
                    </mesh>
                    {/* 목 (좁은 원기둥) */}
                    <mesh castShadow position={[0, 0.78, 0]}>
                        <cylinderGeometry args={[0.1, 0.14, 0.18, 12]} />
                        <meshStandardMaterial color="#6D4C41" roughness={0.4} metalness={0.1}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                    {/* 뚜껑 (검정 원기둥) */}
                    <mesh castShadow position={[0, 0.92, 0]}>
                        <cylinderGeometry args={[0.12, 0.12, 0.1, 12]} />
                        <meshStandardMaterial color="#212121" roughness={0.6} metalness={0.2}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                    {/* 바닥 */}
                    <mesh position={[0, 0.01, 0]}>
                        <cylinderGeometry args={[0.24, 0.24, 0.02, 16]} />
                        <meshStandardMaterial color="#5D4037" roughness={0.5}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                </group>
            );
        case 'B': // 플라스틱 용기: 박스 몸통 + 뚜껑 + 라벨
            return (
                <group scale={scale}>
                    {/* 몸통 (흰색 박스) */}
                    <mesh castShadow position={[0, 0.45, 0]}>
                        <boxGeometry args={[0.5, 0.9, 0.35]} />
                        <meshStandardMaterial ref={materialRef} {...materialProps} roughness={0.8} />
                    </mesh>
                    {/* 뚜껑 (파란색) */}
                    <mesh castShadow position={[0, 0.95, 0]}>
                        <boxGeometry args={[0.52, 0.1, 0.37]} />
                        <meshStandardMaterial color="#1565C0" roughness={0.7} metalness={0.05}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                    {/* 앞면 라벨 (Plane) */}
                    <mesh position={[0, 0.45, 0.176]}>
                        <planeGeometry args={[0.4, 0.55]} />
                        <meshStandardMaterial color="#FFFFFF" roughness={1} metalness={0}
                            transparent opacity={opacity * 0.92}
                            polygonOffset polygonOffsetFactor={-1} />
                    </mesh>
                    {/* 라벨 색상 띠 */}
                    <mesh position={[0, 0.6, 0.177]}>
                        <planeGeometry args={[0.38, 0.08]} />
                        <meshStandardMaterial color="#E53935" roughness={1} metalness={0}
                            transparent opacity={opacity * 0.9}
                            polygonOffset polygonOffsetFactor={-2} />
                    </mesh>
                </group>
            );
        case 'C': // 솔벤트 캔: 원기둥 몸통 + 손잡이
            return (
                <group scale={scale}>
                    {/* 캔 몸통 (금속 원기둥) */}
                    <mesh castShadow position={[0, 0.55, 0]}>
                        <cylinderGeometry args={[0.35, 0.35, 1.1, 20]} />
                        <meshStandardMaterial ref={materialRef} {...materialProps} metalness={0.6} roughness={0.4} />
                    </mesh>
                    {/* 캔 상단 림 */}
                    <mesh castShadow position={[0, 1.1, 0]}>
                        <cylinderGeometry args={[0.36, 0.36, 0.04, 20]} />
                        <meshStandardMaterial color="#9E9E9E" metalness={0.8} roughness={0.3}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                    {/* 캔 하단 림 */}
                    <mesh position={[0, 0.01, 0]}>
                        <cylinderGeometry args={[0.36, 0.36, 0.04, 20]} />
                        <meshStandardMaterial color="#9E9E9E" metalness={0.8} roughness={0.3}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                    {/* 손잡이 (Torus) */}
                    <mesh castShadow position={[0, 1.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
                        <torusGeometry args={[0.15, 0.025, 8, 16, Math.PI]} />
                        <meshStandardMaterial color="#757575" metalness={0.9} roughness={0.2}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                    {/* 주둥이 */}
                    <mesh castShadow position={[0.15, 1.15, 0]}>
                        <cylinderGeometry args={[0.05, 0.06, 0.1, 8]} />
                        <meshStandardMaterial color="#BDBDBD" metalness={0.7} roughness={0.3}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                </group>
            );
        case 'D': // 바이알 박스: 박스 + 칸막이
            return (
                <group scale={scale}>
                    {/* 외곽 박스 */}
                    <mesh castShadow position={[0, 0.25, 0]}>
                        <boxGeometry args={[1.2, 0.5, 0.8]} />
                        <meshStandardMaterial ref={materialRef} {...materialProps} />
                    </mesh>
                    {/* 칸막이 1 */}
                    <mesh position={[-0.3, 0.26, 0]}>
                        <boxGeometry args={[0.02, 0.44, 0.74]} />
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 칸막이 2 */}
                    <mesh position={[0, 0.26, 0]}>
                        <boxGeometry args={[0.02, 0.44, 0.74]} />
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 칸막이 3 */}
                    <mesh position={[0.3, 0.26, 0]}>
                        <boxGeometry args={[0.02, 0.44, 0.74]} />
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 가로 칸막이 */}
                    <mesh position={[0, 0.26, 0]}>
                        <boxGeometry args={[1.14, 0.44, 0.02]} />
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 상단 테두리 */}
                    <mesh position={[0, 0.505, 0]}>
                        <boxGeometry args={[1.22, 0.02, 0.82]} />
                        <meshStandardMaterial color="#E0E0E0" roughness={0.5}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                </group>
            );
        default:
            return null;
    }
};

export const ReagentItem: React.FC<ReagentItemProps> = ({ item, shelfWidth, shelfDepth = 2, isGhost, isValid = true, dimmed = false }) => {
    const setDraggedItem = useFridgeStore(s => s.setDraggedItem);
    const draggedItem = useFridgeStore(s => s.draggedItem);
    const highlightedItemId = useFridgeStore(s => s.highlightedItemId);
    const mode = useFridgeStore(s => s.mode);
    const isBeingDragged = draggedItem?.id === item.id;
    const isHighlighted = highlightedItemId === item.id;

    const setSelectedReagentId = useFridgeStore(s => s.setSelectedReagentId);
    const setHighlightedItemId = useFridgeStore(s => s.setHighlightedItemId);
    const clickStart = React.useRef(0);

    // Auto-clear highlight after 5 seconds
    useEffect(() => {
        if (!isHighlighted) return;
        const timer = setTimeout(() => {
            setHighlightedItemId(null);
        }, 5000);
        return () => clearTimeout(timer);
    }, [isHighlighted, setHighlightedItemId]);

    const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
        if (isGhost) return;
        e.stopPropagation();
        clickStart.current = Date.now();

        // VIEW mode: only allow click (no drag)
        if (mode === 'VIEW') return;

        setDraggedItem({ id: item.id, originalShelfId: item.shelfId, originalPosition: item.position, originalDepthPosition: item.depthPosition });

        // 시각적 피드백
        document.body.style.cursor = 'grabbing';
    };

    const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
        if (isGhost) return;

        // Click Detection
        const elapsed = Date.now() - clickStart.current;
        if (elapsed < 200) {
            e.stopPropagation();
            // If highlighted, clear highlight on click
            if (isHighlighted) {
                setHighlightedItemId(null);
            }
            setSelectedReagentId(item.id);
            // Clicked -> Clear drag immediately so it doesn't count as drag
            if (mode !== 'VIEW') setDraggedItem(null);
            document.body.style.cursor = 'default';
            return;
        }

        if (isBeingDragged) {
            e.stopPropagation();
            document.body.style.cursor = 'default';
            setDraggedItem(null);
        }
    };

    const handlePointerEnter = (e: ThreeEvent<PointerEvent>) => {
        if (isGhost) return;
        e.stopPropagation();
        if (mode !== 'VIEW') {
            document.body.style.cursor = 'grab';
        }
    };

    const handlePointerLeave = () => {
        if (isGhost) return;
        document.body.style.cursor = 'default';
    };

    const centerPct = item.position + item.width / 2;
    const x = (centerPct / 100) * shelfWidth - shelfWidth / 2;
    const depthPos = item.depthPosition ?? 50;
    const z = (depthPos / 100) * shelfDepth - shelfDepth / 2;

    const { position } = useSpring({
        position: [x, 0, z],
        config: { mass: 1, tension: 170, friction: 26 }
    });

    const CONTAINER_COLORS: Record<string, string> = { A: '#8D6E63', B: '#F5F5F5', C: '#78909C', D: '#D7CCC8' };
    const defaultColor = isGhost ? (isValid ? '#4ade80' : '#ef4444') : (CONTAINER_COLORS[item.template] || '#8D6E63');
    let opacity = isGhost ? 0.6 : isBeingDragged ? 0.4 : 1;
    if (dimmed) opacity *= 0.5;

    const scale = item.width / (CONTAINER_BASE_WIDTHS[item.template] || 10);

    return (
        <animated.group
            position={position as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
        >
            <animated.group>
                <ItemGeometry
                    type={item.template}
                    defaultColor={defaultColor}
                    opacity={opacity}
                    scale={scale}
                    isHighlighted={isHighlighted}
                />
            </animated.group>
            {/* Label could go here */}
        </animated.group>
    );
};
