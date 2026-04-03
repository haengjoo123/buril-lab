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

export const CONTAINER_BASE_WIDTHS: Record<string, number> = { A: 8, B: 10, C: 8, D: 15 };

// --- Shared Geometries (Performance Optimization) ---

// Type D: 바이알 박스
const GEO_D_BOX = new THREE.BoxGeometry(1.2, 0.5, 0.8);
const GEO_D_DIV_VERT = new THREE.BoxGeometry(0.02, 0.44, 0.74);
const GEO_D_DIV_HORZ = new THREE.BoxGeometry(1.14, 0.44, 0.02);
const GEO_D_RIM = new THREE.BoxGeometry(1.22, 0.02, 0.82); // vial box rim (type D mesh)

export const ItemGeometry: React.FC<{ type: string; defaultColor: string; opacity?: number; scale?: number; isHighlighted?: boolean; expiryLevel?: ExpiryLevel }> = ({ type, defaultColor, opacity = 1, scale = 1, isHighlighted = false, expiryLevel }) => {

    const materialRef = useRef<THREE.MeshStandardMaterial>(null);
    const highlightColor = useMemo(() => new THREE.Color('#ffff00'), []);
    const baseColor = useMemo(() => new THREE.Color(defaultColor), [defaultColor]);
    const expiryExpiredColor = useMemo(() => new THREE.Color('#ef4444'), []);
    const expiryWarningColor = useMemo(() => new THREE.Color('#f59e0b'), []);

    useFrame((state) => {
        if (!materialRef.current) return;
        if (isHighlighted) {
            // Search highlight takes priority
            const t = state.clock.elapsedTime;
            const intensity = (Math.sin(t * 8) + 1) * 0.4;
            materialRef.current.emissive = highlightColor;
            materialRef.current.emissiveIntensity = intensity;
            materialRef.current.color = highlightColor;
        } else if (expiryLevel === 'expired') {
            // Expired: steady red glow
            materialRef.current.emissive = expiryExpiredColor;
            materialRef.current.emissiveIntensity = 0.35;
            materialRef.current.color = expiryExpiredColor;
        } else if (expiryLevel === 'critical') {
            // Critical (<=7 days): pulsing red glow
            const t = state.clock.elapsedTime;
            const intensity = (Math.sin(t * 4) + 1) * 0.25;
            materialRef.current.emissive = expiryExpiredColor;
            materialRef.current.emissiveIntensity = intensity;
            materialRef.current.color.lerpColors(baseColor, expiryExpiredColor, 0.4);
        } else if (expiryLevel === 'warning') {
            // Warning (<=30 days): subtle amber tint
            const t = state.clock.elapsedTime;
            const intensity = (Math.sin(t * 2) + 1) * 0.12;
            materialRef.current.emissive = expiryWarningColor;
            materialRef.current.emissiveIntensity = intensity;
            materialRef.current.color.lerpColors(baseColor, expiryWarningColor, 0.15);
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
        case 'A': // 갈색 병 GLB 모델
            return (
                <group scale={scale}>
                    <BrownBottleModel
                        onPrimaryMaterialChange={(material) => {
                            materialRef.current = material;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        case 'B': // 플라스틱 용기 GLB 모델
            return (
                <group scale={scale}>
                    <PlasticBottleModel
                        onPrimaryMaterialChange={(material) => {
                            materialRef.current = material;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        case 'C': // 유리병 GLB 모델
            return (
                <group scale={scale}>
                    <GlassBottleModel
                        onPrimaryMaterialChange={(material) => {
                            materialRef.current = material;
                        }}
                        materialProps={materialProps}
                    />
                </group>
            );
        case 'D': // 바이알 박스: 박스 + 칸막이
            return (
                <group scale={scale}>
                    {/* 외곽 박스 - 메인 그림자 캐스터 */}
                    <mesh castShadow position={[0, 0.25, 0]} geometry={GEO_D_BOX}>
                        <meshStandardMaterial ref={materialRef} {...materialProps} />
                    </mesh>
                    {/* 칸막이 1 */}
                    <mesh position={[-0.3, 0.26, 0]} geometry={GEO_D_DIV_VERT}>
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 칸막이 2 */}
                    <mesh position={[0, 0.26, 0]} geometry={GEO_D_DIV_VERT}>
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 칸막이 3 */}
                    <mesh position={[0.3, 0.26, 0]} geometry={GEO_D_DIV_VERT}>
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 가로 칸막이 */}
                    <mesh position={[0, 0.26, 0]} geometry={GEO_D_DIV_HORZ}>
                        <meshStandardMaterial color="#BDBDBD" roughness={0.7}
                            transparent opacity={opacity * 0.7} />
                    </mesh>
                    {/* 상단 테두리 */}
                    <mesh position={[0, 0.505, 0]} geometry={GEO_D_RIM}>
                        <meshStandardMaterial color="#E0E0E0" roughness={0.5}
                            transparent={opacity < 1} opacity={opacity} />
                    </mesh>
                </group>
            );
        default:
            return null;
    }
};

/** 공통 GLB 모델 로더 팩토리 */
function useReagentGLBModel(
    glbPath: string,
    materialProps: Record<string, unknown>,
    onPrimaryMaterialChange: (material: THREE.MeshStandardMaterial | null) => void,
) {
    const { scene } = useGLTF(glbPath);
    const { clonedScene, primaryMaterial } = useMemo(() => {
        const clone = scene.clone(true);
        const overrideErrorColor = materialProps.color === '#ef4444';
        const nextOpacity = typeof materialProps.opacity === 'number' ? materialProps.opacity : undefined;
        let firstMaterial: THREE.MeshStandardMaterial | null = null;

        const cloneMaterial = (original: THREE.Material): THREE.Material => {
            const next = original.clone();
            if (next instanceof THREE.MeshStandardMaterial) {
                next.transparent = true;
                if (nextOpacity !== undefined) {
                    next.opacity = nextOpacity;
                }
                if (overrideErrorColor) {
                    next.color = new THREE.Color('#ef4444');
                }
                if (!firstMaterial) {
                    firstMaterial = next;
                }
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
        return { clonedScene: clone, primaryMaterial: firstMaterial };
    }, [scene, materialProps.color, materialProps.opacity]);

    useEffect(() => {
        onPrimaryMaterialChange(primaryMaterial);
        return () => onPrimaryMaterialChange(null);
    }, [onPrimaryMaterialChange, primaryMaterial]);

    return clonedScene;
}

interface GLBModelProps {
    onPrimaryMaterialChange: (material: THREE.MeshStandardMaterial | null) => void;
    materialProps: Record<string, unknown>;
}

/** GLB 모델 로더 — brown bottle.glb (갈색병) */
const BrownBottleModel: React.FC<GLBModelProps> = ({ onPrimaryMaterialChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/brown bottle.glb', materialProps, onPrimaryMaterialChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

/** GLB 모델 로더 — plastic bottle.glb (플라스틱 통) */
const PlasticBottleModel: React.FC<GLBModelProps> = ({ onPrimaryMaterialChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/plastic bottle.glb', materialProps, onPrimaryMaterialChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

/** GLB 모델 로더 — glass.glb (유리병) */
const GlassBottleModel: React.FC<GLBModelProps> = ({ onPrimaryMaterialChange, materialProps }) => {
    const clonedScene = useReagentGLBModel('/models/reagents/glass.glb', materialProps, onPrimaryMaterialChange);
    return <primitive object={clonedScene} scale={0.5} />;
};

// Preload GLB models
useGLTF.preload('/models/reagents/brown bottle.glb');
useGLTF.preload('/models/reagents/plastic bottle.glb');
useGLTF.preload('/models/reagents/glass.glb');

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

    const CONTAINER_COLORS: Record<string, string> = { A: '#8D6E63', B: '#F5F5F5', C: '#D7CCC8', D: '#b0c4de' };
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
