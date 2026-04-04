/* eslint-disable react-refresh/only-export-components */
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { ReagentPlacement } from '../../types/fridge';
import { useSpring, animated } from '@react-spring/three';
import { useFridgeStore } from '../../store/fridgeStore';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { getExpiryStatus, type ExpiryLevel } from '../../utils/expiryStatus';

interface ReagentItemProps {
    item: ReagentPlacement;
    shelfWidth: number;
    shelfDepth?: number;
    isGhost?: boolean;
    isValid?: boolean;
    /** PLACE 모드에서 비선택 선반의 시약 비활성화 시각 처리 */
    dimmed?: boolean;
}

export const CONTAINER_BASE_WIDTHS: Record<string, number> = { A: 8, B: 10, C: 8, D: 10 };

// --- Geometries are now loaded via GLB models ---

export const ItemGeometry: React.FC<{ type: string; defaultColor: string; opacity?: number; scale?: number; isHighlighted?: boolean; expiryLevel?: ExpiryLevel }> = ({ type, defaultColor, opacity = 1, scale = 1, isHighlighted = false, expiryLevel }) => {

    const materialsRef = useRef<{ mat: THREE.MeshStandardMaterial; origColor: THREE.Color }[]>([]);
    const highlightColor = useMemo(() => new THREE.Color('#ffff00'), []);
    const expiryExpiredColor = useMemo(() => new THREE.Color('#ef4444'), []);
    const expiryWarningColor = useMemo(() => new THREE.Color('#f59e0b'), []);

    useFrame((state) => {
        const entries = materialsRef.current;
        if (entries.length === 0) return;
        for (const { mat, origColor } of entries) {
            if (isHighlighted) {
                const t = state.clock.elapsedTime;
                const intensity = (Math.sin(t * 8) + 1) * 0.4;
                mat.emissive = highlightColor;
                mat.emissiveIntensity = intensity;
                mat.color = highlightColor;
            } else if (expiryLevel === 'expired') {
                mat.emissive = expiryExpiredColor;
                mat.emissiveIntensity = 0.35;
                mat.color = expiryExpiredColor;
            } else if (expiryLevel === 'critical') {
                const t = state.clock.elapsedTime;
                const intensity = (Math.sin(t * 4) + 1) * 0.25;
                mat.emissive = expiryExpiredColor;
                mat.emissiveIntensity = intensity;
                mat.color.copy(origColor);
            } else if (expiryLevel === 'warning') {
                const t = state.clock.elapsedTime;
                const intensity = (Math.sin(t * 2) + 1) * 0.12;
                mat.emissive = expiryWarningColor;
                mat.emissiveIntensity = intensity;
                mat.color.copy(origColor);
            } else {
                mat.emissiveIntensity = 0;
                mat.color.copy(origColor);
            }
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
        case 'A': // 갈색 병 GLB 모델
            return (
                <group scale={scale}>
                    <BrownBottleModel
                        onMaterialsChange={(mats) => {
                            materialsRef.current = mats;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        case 'B': // 플라스틱 용기 GLB 모델
            return (
                <group scale={scale}>
                    <PlasticBottleModel
                        onMaterialsChange={(mats) => {
                            materialsRef.current = mats;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        case 'C': // 유리병 GLB 모델
            return (
                <group scale={scale}>
                    <GlassBottleModel
                        onMaterialsChange={(mats) => {
                            materialsRef.current = mats;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        case 'D': // 사각병 GLB 모델
            return (
                <group scale={scale}>
                    <SquareBottleModel
                        onMaterialsChange={(mats) => {
                            materialsRef.current = mats;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        default:
            return null;
    }
};

type MaterialEntry = { mat: THREE.MeshStandardMaterial; origColor: THREE.Color };

/** 공통 GLB 모델 로더 팩토리 */
function useReagentGLBModel(
    glbPath: string,
    materialProps: Record<string, unknown>,
    onMaterialsChange: (entries: MaterialEntry[]) => void,
) {
    const { scene } = useGLTF(glbPath);
    const { clonedScene, allEntries } = useMemo(() => {
        const clone = scene.clone(true);
        const overrideErrorColor = materialProps.color === '#ef4444';
        const nextOpacity = typeof materialProps.opacity === 'number' ? materialProps.opacity : undefined;
        const collected: MaterialEntry[] = [];

        const cloneMaterial = (original: THREE.Material): THREE.Material => {
            const next = original.clone();
            if (next instanceof THREE.MeshStandardMaterial) {
                // 원본 색상 기록 (나중에 복원용)
                const origColor = next.color.clone();
                if (nextOpacity !== undefined) {
                    next.opacity = nextOpacity;
                    next.transparent = nextOpacity < 1;
                } else {
                    // GLB 원본 투명도 무시 — 불투명으로 강제
                    next.transparent = false;
                    next.opacity = 1;
                }
                if (overrideErrorColor) {
                    next.color = new THREE.Color('#ef4444');
                }
                collected.push({ mat: next, origColor });
            }
            return next;
        };

        clone.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
                const mesh = node as THREE.Mesh;
                mesh.material = Array.isArray(mesh.material)
                    ? mesh.material.map((mat) => cloneMaterial(mat))
                    : cloneMaterial(mesh.material);
                mesh.castShadow = true;
            }
        });
        return { clonedScene: clone, allEntries: collected };
    }, [scene, materialProps.color, materialProps.opacity]);

    useEffect(() => {
        onMaterialsChange(allEntries);
        return () => onMaterialsChange([]);
    }, [onMaterialsChange, allEntries]);

    return clonedScene;
}

interface GLBModelProps {
    onMaterialsChange: (entries: MaterialEntry[]) => void;
    materialProps: Record<string, unknown>;
}

/** GLB 모델 로더 — brown bottle.glb (갈색병) */
const BrownBottleModel: React.FC<GLBModelProps> = ({ onMaterialsChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/brown bottle.glb', materialProps, onMaterialsChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

/** GLB 모델 로더 — plastic bottle.glb (플라스틱 통) */
const PlasticBottleModel: React.FC<GLBModelProps> = ({ onMaterialsChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/plastic bottle.glb', materialProps, onMaterialsChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

/** GLB 모델 로더 — glass.glb (유리병) */
const GlassBottleModel: React.FC<GLBModelProps> = ({ onMaterialsChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/glass.glb', materialProps, onMaterialsChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

/** GLB 모델 로더 — square bottle.glb (사각병) */
const SquareBottleModel: React.FC<GLBModelProps> = ({ onMaterialsChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/square bottle.glb', materialProps, onMaterialsChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

// Preload GLB models
useGLTF.preload('/models/reagents/brown bottle.glb');
useGLTF.preload('/models/reagents/plastic bottle.glb');
useGLTF.preload('/models/reagents/glass.glb');
useGLTF.preload('/models/reagents/square bottle.glb');

export const ReagentItem: React.FC<ReagentItemProps> = ({ item, shelfWidth, shelfDepth = 2, isGhost, isValid = true, dimmed = false }) => {
    const setDraggedItem = useFridgeStore(s => s.setDraggedItem);
    const draggedItem = useFridgeStore(s => s.draggedItem);
    const highlightedItemId = useFridgeStore(s => s.highlightedItemId);
    const mode = useFridgeStore(s => s.mode);
    const isBeingDragged = draggedItem?.id === item.id;
    const isHighlighted = Array.isArray(highlightedItemId)
        ? highlightedItemId.includes(item.id)
        : highlightedItemId === item.id;

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

    const CONTAINER_COLORS: Record<string, string> = { A: '#8D6E63', B: '#F5F5F5', C: '#D7CCC8', D: '#eeeeee' };
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
                    expiryLevel={(() => {
                        if (isGhost || dimmed) return undefined;
                        const status = getExpiryStatus(item.expiryDate);
                        return status?.level ?? undefined;
                    })()}
                />
            </animated.group>
            {/* Label could go here */}
        </animated.group>
    );
};
