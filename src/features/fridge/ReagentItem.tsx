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
        case 'A': // Small Brown Bottle
            return (
                <mesh castShadow position={[0, 0.4 * scale, 0]} scale={scale}>
                    <cylinderGeometry args={[0.2, 0.2, 0.8, 16]} />
                    <meshStandardMaterial ref={materialRef} {...materialProps} />
                </mesh>
            );
        case 'B': // Plastic Container
            return (
                <mesh castShadow position={[0, 0.5 * scale, 0]} scale={scale}>
                    <boxGeometry args={[0.5, 1.0, 0.5]} />
                    <meshStandardMaterial ref={materialRef} {...materialProps} roughness={0.8} />
                </mesh>
            );
        case 'C': // Solvent Can
            return (
                <mesh castShadow position={[0, 0.6 * scale, 0]} scale={scale}>
                    <boxGeometry args={[0.8, 1.2, 0.8]} />
                    <meshStandardMaterial ref={materialRef} {...materialProps} metalness={0.6} roughness={0.4} />
                </mesh>
            );
        case 'D': // Vial Box
            return (
                <mesh castShadow position={[0, 0.25 * scale, 0]} scale={scale}>
                    <boxGeometry args={[1.2, 0.5, 0.8]} />
                    <meshStandardMaterial ref={materialRef} {...materialProps} />
                </mesh>
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

    const defaultColor = isGhost ? (isValid ? '#4ade80' : '#ef4444') : '#8D6E63';
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
