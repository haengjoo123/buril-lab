import React from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { ReagentPlacement } from '../../types/fridge';
import { useSpring, animated } from '@react-spring/three';
import { useFridgeStore } from '../../store/fridgeStore';

interface ReagentItemProps {
    item: ReagentPlacement;
    shelfWidth: number;
    shelfDepth?: number;
    isGhost?: boolean;
    isValid?: boolean;
    /** PLACE 모드에서 비선택 선반의 시약 비활성화 시각 처리 */
    dimmed?: boolean;
}

export const ItemGeometry: React.FC<{ type: string; color: string; opacity?: number }> = ({ type, color, opacity = 1 }) => {
    const materialProps = {
        color,
        transparent: opacity < 1,
        opacity,
        roughness: 0.3,
        metalness: 0.1
    };

    switch (type) {
        case 'A': // Small Brown Bottle
            return (
                <mesh castShadow position={[0, 0.4, 0]}>
                    <cylinderGeometry args={[0.2, 0.2, 0.8, 16]} />
                    <meshStandardMaterial {...materialProps} />
                </mesh>
            );
        case 'B': // Plastic Container
            return (
                <mesh castShadow position={[0, 0.5, 0]}>
                    <boxGeometry args={[0.5, 1.0, 0.5]} />
                    <meshStandardMaterial {...materialProps} roughness={0.8} />
                </mesh>
            );
        case 'C': // Solvent Can
            return (
                <mesh castShadow position={[0, 0.6, 0]}>
                    <boxGeometry args={[0.8, 1.2, 0.8]} />
                    <meshStandardMaterial {...materialProps} metalness={0.6} roughness={0.4} />
                </mesh>
            );
        case 'D': // Vial Box
            return (
                <mesh castShadow position={[0, 0.25, 0]}>
                    <boxGeometry args={[1.2, 0.5, 0.8]} />
                    <meshStandardMaterial {...materialProps} />
                </mesh>
            );
        default:
            return null;
    }
};

export const ReagentItem: React.FC<ReagentItemProps> = ({ item, shelfWidth, shelfDepth = 2, isGhost, isValid = true, dimmed = false }) => {
    const setDraggedItem = useFridgeStore(s => s.setDraggedItem);
    const draggedItem = useFridgeStore(s => s.draggedItem);
    const isBeingDragged = draggedItem?.id === item.id;

    const setSelectedReagentId = useFridgeStore(s => s.setSelectedReagentId);
    const clickStart = React.useRef(0);

    const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
        if (isGhost) return;
        e.stopPropagation();
        clickStart.current = Date.now();
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
            setSelectedReagentId(item.id);
            // Clicked -> Clear drag immediately so it doesn't count as drag
            setDraggedItem(null);
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
        document.body.style.cursor = 'grab';
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

    const color = isGhost ? (isValid ? '#4ade80' : '#ef4444') : '#8D6E63';
    let opacity = isGhost ? 0.6 : isBeingDragged ? 0.4 : 1;
    if (dimmed) opacity *= 0.5;

    return (
        <animated.group
            position={position as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
        >
            <ItemGeometry type={item.template} color={color} opacity={opacity} />
            {/* Label could go here */}
        </animated.group>
    );
};
