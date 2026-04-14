import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { ReagentPlacement } from '../../types/fridge';
import { useSpring, animated } from '@react-spring/three';
import { useFridgeStore } from '../../store/fridgeStore';
import * as THREE from 'three';
import { useGLTF, Text } from '@react-three/drei';
import { getExpiryStatus, type ExpiryLevel } from '../../utils/expiryStatus';
import { CONTAINER_BASE_WIDTHS } from '../../utils/reagentPlacementMetrics';

interface ReagentItemProps {
    item: ReagentPlacement;
    shelfWidth: number;
    shelfDepth?: number;
    isGhost?: boolean;
    isValid?: boolean;
    /** PLACE 모드에서 비선택 선반의 시약 비활성화 시각 처리 */
    dimmed?: boolean;
}

export { CONTAINER_BASE_WIDTHS } from '../../utils/reagentPlacementMetrics';

// --- Geometries are now loaded via GLB models ---

export const ItemGeometry: React.FC<{ type: string; defaultColor: string; opacity?: number; scale?: number; isHighlighted?: boolean; expiryLevel?: ExpiryLevel }> = ({ type, defaultColor, opacity = 1, scale = 1, isHighlighted = false, expiryLevel }) => {

    const materialsRef = useRef<{ mat: THREE.MeshStandardMaterial; origColor: THREE.Color }[]>([]);
    const highlightColor = useMemo(() => new THREE.Color('#67e8f9'), []);
    const expiryExpiredColor = useMemo(() => new THREE.Color('#ef4444'), []);
    const expiryWarningColor = useMemo(() => new THREE.Color('#f59e0b'), []);

    useFrame((state) => {
        const entries = materialsRef.current;
        if (entries.length === 0) return;
        for (const { mat, origColor } of entries) {
            if (isHighlighted) {
                const t = state.clock.elapsedTime;
                const intensity = 0.45 + ((Math.sin(t * 7) + 1) * 0.25);
                mat.emissive.copy(highlightColor);
                mat.emissiveIntensity = intensity;
                mat.color.copy(origColor).lerp(highlightColor, 0.45);
            } else if (expiryLevel === 'expired') {
                mat.emissive.copy(expiryExpiredColor);
                mat.emissiveIntensity = 0.35;
                mat.color.copy(expiryExpiredColor);
            } else if (expiryLevel === 'critical') {
                const t = state.clock.elapsedTime;
                const intensity = (Math.sin(t * 4) + 1) * 0.25;
                mat.emissive.copy(expiryExpiredColor);
                mat.emissiveIntensity = intensity;
                mat.color.copy(origColor);
            } else if (expiryLevel === 'warning') {
                const t = state.clock.elapsedTime;
                const intensity = (Math.sin(t * 2) + 1) * 0.12;
                mat.emissive.copy(expiryWarningColor);
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

    // 라벨 표시 텍스트 — 최대 6자까지만 표시, 초과 시 말줄임
    const labelText = useMemo(() => {
        const name = item.name || '';
        return name.length > 6 ? name.slice(0, 5) + '…' : name;
    }, [item.name]);

    // 병 높이에 따른 텍스트 Y 위치 (병 상단 약간 위)
    const labelY = useMemo(() => {
        const baseHeights: Record<string, number> = { A: 1.1, B: 1.2, C: 1.0, D: 1.1 };
        return (baseHeights[item.template] || 1.1) * scale;
    }, [item.template, scale]);

    const showLabel = !isGhost && !isBeingDragged && !dimmed;

    // 카메라 극각(polar angle) 기반 텍스트 방향 및 실제 모델 높이 감지
    const labelGroupRef = useRef<THREE.Group>(null);
    const geometryGroupRef = useRef<THREE.Group>(null);
    const lastScale = useRef<number>(0);
    const measuredYRef = useRef<number | null>(null);

    useFrame(({ camera }) => {
        const labelGroup = labelGroupRef.current;
        if (!labelGroup) return;

        // 1. 실제 모델의 Bounding Box를 이용한 정밀한 높이 계산 (스케일 변경 시만 재계산)
        if (geometryGroupRef.current && lastScale.current !== scale) {
            geometryGroupRef.current.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(geometryGroupRef.current);
            const height = box.max.y - box.min.y;
            
            // 높이가 정상적으로 계산되었을 경우에만 적용
            if (height > 0 && height !== Infinity) {
                // anchorY="middle"이고 폰트 크기를 고정(0.16)했으므로, 병 상단에서 띄울 고정 여백 설정
                const margin = 0.13;
                measuredYRef.current = height + margin;
                lastScale.current = scale;
            }
        }

        // React 리렌더링(클릭 등) 시 position prop이 덮어씌워지는 것을 방지하기 위해 
        // 측정된 값이 있다면 매 프레임 y 좌표를 강제 고정
        if (measuredYRef.current !== null) {
            labelGroup.position.y = measuredYRef.current;
        }

        // 2. 카메라 방향에 따른 텍스트 전환 (위에서 볼때 눕기)
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const polarAngle = Math.acos(-dir.y);
        const isTopView = polarAngle < Math.PI / 4;

        if (isTopView) {
            // 위에서 보기: 바닥에 눕힘
            labelGroup.rotation.set(-Math.PI / 2, 0, 0);
        } else {
            // 일반 뷰: 패널이 항상 카메라를 바라보도록
            labelGroup.quaternion.copy(camera.quaternion);
        }
    });

    return (
        <animated.group
            position={position as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
        >
            <animated.group ref={geometryGroupRef}>
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
            {/* 시약명 3D 텍스트 라벨 */}
            {isHighlighted && !isGhost && (
                <mesh position={[0, labelY + 0.28, 0]}>
                    <sphereGeometry args={[0.08, 24, 24]} />
                    <meshBasicMaterial color="#a5f3fc" transparent opacity={0.95} toneMapped={false} />
                </mesh>
            )}
            {showLabel && labelText && (
                <group ref={labelGroupRef} position={[0, labelY, 0]}>
                    <Text
                        fontSize={0.16} // 사이즈 고정
                        color="#1e293b"
                        anchorX="center"
                        anchorY="middle"
                        maxWidth={1.5}
                        textAlign="center"
                        outlineWidth={0.02}
                        outlineColor="#ffffff"
                        font="/fonts/NotoSansKR-Medium.ttf"
                        position-z={0} // Z-fighting 방지 및 정위치 확보
                    >
                        {labelText}
                    </Text>
                </group>
            )}
        </animated.group>
    );
};
