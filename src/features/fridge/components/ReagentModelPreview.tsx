/**
 * ReagentModelPreview — 시약 목록 트레이에서 GLB 모델을 3D로 미리보기하는 컴포넌트
 *
 * 작은 Canvas 안에 GLB 모델을 로드하여 자동 회전하며 보여줍니다.
 * bounding box 기반으로 자동 센터링 & 스케일링하여 모든 모델이 프레임을 꽉 채웁니다.
 */
import React, { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

type ContainerType = 'A' | 'B' | 'C' | 'D';

const GLB_MAP: Record<ContainerType, string> = {
    A: '/models/reagents/brown bottle.glb',
    B: '/models/reagents/plastic bottle.glb',
    C: '/models/reagents/glass.glb',
    D: '/models/reagents/square bottle.glb',
};

interface ReagentModelPreviewProps {
    type: ContainerType;
    /** 미리보기 컨테이너 너비 (px). 기본 60 */
    width?: number;
    /** 미리보기 컨테이너 높이 (px). 기본 80 */
    height?: number;
}

/** 내부: GLB 모델 씬 — bounding box 기반 자동 fit */
const ModelScene: React.FC<{ type: ContainerType }> = ({ type }) => {
    const { scene } = useGLTF(GLB_MAP[type]);

    const { clonedScene, fitScale, centerOffset } = useMemo(() => {
        const clone = scene.clone(true);
        // 불투명으로 강제
        clone.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
                const mesh = node as THREE.Mesh;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach((mat) => {
                    if (mat instanceof THREE.MeshStandardMaterial) {
                        mat.transparent = false;
                        mat.opacity = 1;
                    }
                });
            }
        });

        // bounding box 기반 스케일 & 센터 계산
        const box = new THREE.Box3().setFromObject(clone);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());

        // 프레임을 채우도록 가장 큰 축 기준 스케일 계산 (목표 크기 ~2.0 유닛)
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 2.0;
        const scale = maxDim > 0 ? targetSize / maxDim : 1;

        return {
            clonedScene: clone,
            fitScale: scale,
            centerOffset: new THREE.Vector3(-center.x * scale, -center.y * scale, -center.z * scale),
        };
    }, [scene]);

    return (
        <group position={centerOffset}>
            <primitive object={clonedScene} scale={fitScale} />
        </group>
    );
};

/** Fallback: 로딩 중 표시할 간단한 박스 */
const LoadingFallback: React.FC = () => (
    <mesh>
        <boxGeometry args={[0.5, 0.8, 0.5]} />
        <meshStandardMaterial color="#e2e8f0" transparent opacity={0.5} />
    </mesh>
);

const ReagentModelPreview: React.FC<ReagentModelPreviewProps> = ({
    type,
    width = 60,
    height = 80,
}) => {
    return (
        <div
            style={{ width, height }}
            className="rounded-lg overflow-hidden"
        >
            <Canvas
                camera={{ position: [2.3, 1.0, 2.3], fov: 40, near: 0.1, far: 100 }}
                dpr={[1, 2]}
                gl={{ antialias: true, alpha: true }}
                style={{ background: 'transparent' }}
            >
                <ambientLight intensity={1.0} />
                <directionalLight position={[3, 4, 2]} intensity={1.5} />
                <directionalLight position={[-2, 3, -1]} intensity={0.6} />
                <Suspense fallback={<LoadingFallback />}>
                    <ModelScene type={type} />
                </Suspense>
            </Canvas>
        </div>
    );
};

export default ReagentModelPreview;
