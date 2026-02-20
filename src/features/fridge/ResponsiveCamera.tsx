import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ResponsiveCameraProps {
    cabinetWidth: number;
    cabinetHeight: number;
    config: {
        position: [number, number, number];
        minDistance: number;
        maxDistance: number;
        target: [number, number, number];
    };
}

const LERP_FACTOR = 0.06;
const ARRIVAL_THRESHOLD = 0.05;

/** 시약장 크기 변경 시 OrbitControls 동기화, 부드러운 전환. 줌/팬 시 즉시 보간 중단 */
export function ResponsiveCamera({ config }: ResponsiveCameraProps) {
    const { camera, controls, gl } = useThree();
    const targetPos = useRef(new THREE.Vector3(...config.position));
    const targetLookAt = useRef(new THREE.Vector3(...config.target));
    const isAnimating = useRef(true);
    const lastConfigKey = useRef('');

    useEffect(() => {
        const key = `${config.position.join(',')}|${config.target.join(',')}`;
        if (lastConfigKey.current === key) return;
        lastConfigKey.current = key;

        targetPos.current.set(...config.position);
        targetLookAt.current.set(...config.target);
        isAnimating.current = true;
    }, [config.position[0], config.position[1], config.position[2], config.target[0], config.target[1], config.target[2]]);

    // 줌/팬 시 보간 즉시 중단 → OrbitControls가 제어
    useEffect(() => {
        const el = gl.domElement;
        const stopAnim = () => { isAnimating.current = false; };
        el.addEventListener('wheel', stopAnim, { passive: true });
        el.addEventListener('pointerdown', stopAnim);
        return () => {
            el.removeEventListener('wheel', stopAnim);
            el.removeEventListener('pointerdown', stopAnim);
        };
    }, [gl]);

    useFrame(() => {
        const orbit = controls as { target: THREE.Vector3; update?: () => void } | null;
        if (!orbit?.target) return;

        if (!isAnimating.current) return;

        camera.position.lerp(targetPos.current, LERP_FACTOR);
        orbit.target.lerp(targetLookAt.current, LERP_FACTOR);
        orbit.update?.();

        const posDist = camera.position.distanceTo(targetPos.current);
        const tgtDist = orbit.target.distanceTo(targetLookAt.current);
        if (posDist < ARRIVAL_THRESHOLD && tgtDist < ARRIVAL_THRESHOLD) {
            isAnimating.current = false;
        }
    });

    return null;
}
