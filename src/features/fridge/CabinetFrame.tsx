import React from 'react';

interface CabinetFrameProps {
    width: number;
    depth: number;
    cabinetHeight: number;
    /** PLACE 모드에서 선반 포커스 시 테두리·패널 전체 흐리게 */
    dimmed?: boolean;
    /** 탑뷰 모드 시 상판을 숨겨서 위에서 내려다볼 수 있게 함 */
    hideTop?: boolean;
}

const WALL = 0.12;
const BOTTOM_Y = -0.25;
const DIM_OPACITY = 0.28;

// 시약장 외곽 프레임 (뒷면, 양 벽, 상/하판, 전면 테두리) - cabinetHeight를 기준으로 항상 반영
export const CabinetFrame: React.FC<CabinetFrameProps> = ({
    width,
    depth,
    cabinetHeight,
    dimmed = false,
    hideTop = false,
}) => {
    const bottomY = BOTTOM_Y;
    const topY = bottomY + cabinetHeight;
    const height = cabinetHeight;
    const centerY = (bottomY + topY) / 2;
    const outerWidth = width + WALL * 2;

    const opacity = dimmed ? DIM_OPACITY : 1;
    // transparent는 항상 true로 두고 opacity만 변경 (동적 토글 시 반영 안 됨)
    const wallMat = { color: '#e4e4e7', roughness: 0.6, metalness: 0.15, transparent: true, opacity, depthWrite: !dimmed };
    const innerPanelMat = { color: '#ebe9e4', roughness: 0.7, metalness: 0.1, transparent: true, opacity, depthWrite: !dimmed };
    const backPanelMat = { color: '#dde4ee', roughness: 0.8, metalness: 0.05, transparent: true, opacity, depthWrite: !dimmed };
    const frameMat = { color: '#3b82f6', roughness: 0.4, metalness: 0.3, transparent: true, opacity, depthWrite: !dimmed };

    // 각 패널이 겹치지 않도록 영역 분리
    // Z축 구간: [뒷면 패널] [좌우 벽 + 상하판] [전면 프레임]
    const backFrontZ = -depth / 2;                   // 뒷면 패널 앞면 z
    const framBackZ = depth / 2;                     // 전면 프레임 뒷면 z
    const sideDepth = framBackZ - backFrontZ;        // 좌우벽이 차지하는 깊이
    const sideCenterZ = (backFrontZ + framBackZ) / 2;

    const matKey = dimmed ? 'dimmed' : 'normal';
    return (
        <group>
            {/* 뒷면 패널 - 구분되는 파란빛 회색 */}
            <mesh position={[0, centerY, -depth / 2 - WALL / 2]} receiveShadow>
                <boxGeometry args={[outerWidth, height + WALL * 2, WALL]} />
                <meshStandardMaterial key={matKey} {...backPanelMat} />
            </mesh>

            {/* 왼쪽 벽 */}
            <mesh position={[-width / 2 - WALL / 2, centerY, sideCenterZ]} castShadow receiveShadow>
                <boxGeometry args={[WALL, height, sideDepth]} />
                <meshStandardMaterial key={matKey} {...wallMat} />
            </mesh>

            {/* 오른쪽 벽 */}
            <mesh position={[width / 2 + WALL / 2, centerY, sideCenterZ]} castShadow receiveShadow>
                <boxGeometry args={[WALL, height, sideDepth]} />
                <meshStandardMaterial key={matKey} {...wallMat} />
            </mesh>

            {/* 상판 - 탑뷰 시 숨김 */}
            {!hideTop && (
                <mesh position={[0, topY + WALL / 2, sideCenterZ]} castShadow receiveShadow>
                    <boxGeometry args={[outerWidth, WALL, sideDepth]} />
                    <meshStandardMaterial key={matKey} {...innerPanelMat} />
                </mesh>
            )}

            {/* 하판 */}
            <mesh position={[0, bottomY - WALL / 2, sideCenterZ]} receiveShadow>
                <boxGeometry args={[outerWidth, WALL, sideDepth]} />
                <meshStandardMaterial key={matKey} {...innerPanelMat} />
            </mesh>

            {/* 전면 프레임 - 상단/하단 테두리, 좌우 기둥 */}
            {!hideTop && (
                <mesh position={[0, topY + WALL / 2, framBackZ + WALL / 2]} castShadow>
                    <boxGeometry args={[outerWidth, WALL * 1.5, WALL]} />
                    <meshStandardMaterial key={matKey} {...frameMat} />
                </mesh>
            )}
            {/* 하단 테두리 - WALL로 낮춰 아래 칸이 가려지지 않도록 */}
            <mesh position={[0, bottomY - WALL / 2, framBackZ + WALL / 2]} castShadow>
                <boxGeometry args={[outerWidth, WALL, WALL]} />
                <meshStandardMaterial key={matKey} {...frameMat} />
            </mesh>
            <mesh position={[-width / 2 - WALL / 2, centerY, framBackZ + WALL / 2]} castShadow>
                <boxGeometry args={[WALL, height - WALL * 0.5, WALL]} />
                <meshStandardMaterial key={matKey} {...frameMat} />
            </mesh>
            <mesh position={[width / 2 + WALL / 2, centerY, framBackZ + WALL / 2]} castShadow>
                <boxGeometry args={[WALL, height - WALL * 0.5, WALL]} />
                <meshStandardMaterial key={matKey} {...frameMat} />
            </mesh>
        </group>
    );
};
