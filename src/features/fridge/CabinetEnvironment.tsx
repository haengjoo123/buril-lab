import { Component, Suspense, type ReactNode } from 'react';
import { Environment } from '@react-three/drei';

// Environment loading is isolated: the cabinet and its fill lights remain
// visible while the HDR downloads, or if that request fails.
class EnvironmentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? null : this.props.children; }
}

export function CabinetEnvironment({ intensity }: { intensity: number }) {
    return <EnvironmentBoundary>
        <Suspense fallback={null}>
            <Environment files="/environments/cabinet-city.hdr" environmentIntensity={intensity} />
        </Suspense>
    </EnvironmentBoundary>;
}
