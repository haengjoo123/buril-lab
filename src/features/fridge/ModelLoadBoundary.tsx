import { Component, type ReactNode } from 'react';
import { Html, useGLTF } from '@react-three/drei';

export function ModelPlaceholder({ failed = false }: { failed?: boolean }) {
    return <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.3, 0.7, 0.3]} />
        <meshStandardMaterial color={failed ? '#ef4444' : '#94a3b8'} wireframe />
    </mesh>;
}

export class ModelLoadBoundary extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() {
        if (!this.state.failed) return this.props.children;
        return <>
            <ModelPlaceholder failed />
            <Html position={[0, 0.9, 0]} center>
                <button type="button" title="3D 모델 다시 불러오기" aria-label="3D 모델 다시 불러오기" className="h-8 w-8 rounded border bg-white text-lg text-red-700" onClick={() => {
                    useGLTF.clear(this.props.path);
                    this.setState({ failed: false });
                }}>↻</button>
            </Html>
        </>;
    }
}
