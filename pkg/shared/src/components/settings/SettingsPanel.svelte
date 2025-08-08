<script lang="ts">
	import {
		settings,
		sharedSettings,
		localSettings,
		isLocalMode,
		updateSharedSettings,
		updateLocalSettings
	} from '../../stores/settingsStore';
	import type { ImageInfo } from '../../services/api';
	import ImageGrid from '$shared/components/settings/ImageGrid.svelte';
	import { SliderControl, ToggleControl } from './';

	// Props
	export let expanded: boolean = false;
	export let images: ImageInfo[] = [];
	//export let errorMessage: string = "";
	export let settingsPanel: HTMLElement | null = null;
	let isReconnecting = false;

	// Subscribe to settings store
	$: {
		if ($settings.selectedImage && !images.some((img) => img.name === $settings.selectedImage)) {
			// If the selected image no longer exists in the images list, reset it
			updateSharedSettings((settings) => ({
				...settings,
				selectedImage: images[0]?.name || ''
			}));
		}
	}

	function handleSettingChange<K extends keyof typeof $settings>(
		key: K,
		value: (typeof $settings)[K] | null
	) {
		if ($isLocalMode) {
			if (value === null) {
				// Remove from local settings
				updateLocalSettings((current) => {
					if (!current) return {};
					const { [key]: _, ...rest } = current;
					return Object.keys(rest).length > 0 ? rest : {};
				});
			} else {
				// Update local settings
				updateLocalSettings((current) => ({
					...current,
					[key]: value
				}));
			}
		} else {
			// Update shared settings
			updateSharedSettings((current) => ({
				...current,
				[key]: value
			}));
		}
	}

	async function handleReconnect() {
		isReconnecting = true;
		const event = new CustomEvent('reconnectApi');
		window.dispatchEvent(event);

		// Reset reconnecting state after a short delay
		setTimeout(() => {
			isReconnecting = false;
		}, 2000);
	}
</script>

<div class="settings-panel" bind:this={settingsPanel} class:expanded>
	<div class="settings-content">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-xl font-semibold">Settings</h2>
			<div class="flex items-center space-x-2">
				<button
					class="btn btn-sm {!$isLocalMode ? 'btn-primary' : 'btn-ghost'}"
					on:click={() => isLocalMode.set(false)}
				>
					Shared
				</button>
				<button
					class="btn btn-sm {$isLocalMode ? 'btn-primary' : 'btn-ghost'}"
					on:click={() => isLocalMode.set(true)}
				>
					Local
				</button>
			</div>
		</div>

		<div class="space-y-6">
			<!-- Image Selection -->
			<div class="setting-section">
				<h3 class="mb-2 text-lg font-medium">Background Image</h3>
				<!-- Display Options -->
				<ImageGrid
					{images}
					selectedImage={$settings.selectedImage}
					isOverride={$isLocalMode}
					overrideValue={$localSettings?.selectedImage}
					onImageChange={(newImage: string) => handleSettingChange('selectedImage', newImage)}
				/>

				<SliderControl
					label="Brightness"
					value={$isLocalMode ? ($localSettings?.opacity ?? null) : $sharedSettings.opacity}
					min={0}
					max={1}
					step={0.01}
					onChange={(newOpacity: number | null) => handleSettingChange('opacity', newOpacity)}
					formatValue={(v: number) => v.toFixed(2)}
					isOverride={$isLocalMode}
					defaultValue={$settings.opacity}
					overrideValue={$localSettings?.opacity}
				/>

				<SliderControl
					label="Saturation"
					value={$isLocalMode ? ($localSettings?.saturation ?? null) : $sharedSettings.saturation}
					min={0}
					max={2}
					step={0.01}
					onChange={(newSaturation: number | null) =>
						handleSettingChange('saturation', newSaturation)}
					formatValue={(v: number) => v.toFixed(2)}
					isOverride={$isLocalMode}
					defaultValue={$settings.saturation}
					overrideValue={$localSettings?.saturation}
				/>

				<SliderControl
					label="Blur"
					value={$isLocalMode ? ($localSettings?.blur ?? null) : $sharedSettings.blur}
					min={0}
					max={50}
					step={0.1}
					onChange={(newBlur: number | null) => handleSettingChange('blur', newBlur)}
					formatValue={(v: number) => `${v.toFixed(1)}px`}
					isOverride={$isLocalMode}
					defaultValue={$settings.blur}
					overrideValue={$localSettings?.blur}
				/>

				<SliderControl
					label="Transition Time"
					value={$isLocalMode
						? ($localSettings?.transitionTime ?? null)
						: $sharedSettings.transitionTime}
					min={0}
					max={10}
					step={0.1}
					onChange={(newTransitionTime: number | null) =>
						handleSettingChange('transitionTime', newTransitionTime)}
					formatValue={(v: number) => `${v.toFixed(1)}s`}
					isOverride={$isLocalMode}
					defaultValue={$settings.transitionTime}
					overrideValue={$localSettings?.transitionTime}
				/>
			</div>

			<ToggleControl
				label="Time and date"
				checked={$isLocalMode
					? ($localSettings?.showTimeDate ?? $settings.showTimeDate)
					: $sharedSettings.showTimeDate}
				onChange={(newShowTimeDate: boolean | null) =>
					handleSettingChange('showTimeDate', newShowTimeDate)}
				isOverride={$isLocalMode}
				overrideValue={$localSettings?.showTimeDate}
				defaultValue={$settings.showTimeDate}
			/>

			<ToggleControl
				label="Weather"
				checked={$isLocalMode
					? ($localSettings?.showWeather ?? $settings.showWeather)
					: $sharedSettings.showWeather}
				onChange={(newShowWeather: boolean | null) =>
					handleSettingChange('showWeather', newShowWeather)}
				isOverride={$isLocalMode}
				overrideValue={$localSettings?.showWeather}
				defaultValue={$settings.showWeather}
			/>

			<ToggleControl
				label="Auto-hide settings button"
				checked={$isLocalMode
					? ($localSettings?.hideButton ?? $settings.hideButton)
					: $sharedSettings.hideButton}
				onChange={(newHideButton: boolean | null) =>
					handleSettingChange('hideButton', newHideButton)}
				isOverride={$isLocalMode}
				overrideValue={$localSettings?.hideButton}
				defaultValue={$settings.hideButton}
			/>

			<ToggleControl
				label="Show screen switcher"
				checked={$isLocalMode
					? ($localSettings?.showScreenSwitcher ?? $settings.showScreenSwitcher)
					: $sharedSettings.showScreenSwitcher}
				onChange={(newShowScreenSwitcher: boolean | null) =>
					handleSettingChange('showScreenSwitcher', newShowScreenSwitcher)}
				isOverride={$isLocalMode}
				overrideValue={$localSettings?.showScreenSwitcher}
				defaultValue={$settings.showScreenSwitcher}
			/>

			<!--<PositionSelector
                isOverride={$isLocalMode}
                overrideValue={$localSettings?.settingsButtonPosition ?? null}
                onOverride={(newPosition) =>
                    handleSettingChange("settingsButtonPosition", newPosition)}
            />-->

			<!-- <ApiConfig
                onApiUrlChange={apiBaseUrl.set}
                onReconnect={handleReconnect}
            />-->
		</div>
	</div>
</div>

<style>
	.settings-panel {
		position: fixed;
		top: 50%;
		right: 10px;
		transform: translate(0, -50%);
		/* background-color: rgba(0, 0, 0, 0.4); */
		padding: 2rem;
		border-radius: 1rem;
		color: white;
		min-width: 450px;
		max-width: 120vw;
		max-height: 90vh;
		overflow-y: auto;
		z-index: 1000;
		backdrop-filter: blur(10px);
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
		transition: opacity 0.3s cubic-bezier(0.9, 0.14, 1, 0.75);

		opacity: 0;
	}

	.settings-panel.expanded {
		transition: opacity 0.3s cubic-bezier(0.35, 1.04, 0.58, 1);
		opacity: 1;
	}

	.settings-content {
		max-width: 600px;
		margin: 0 auto;
	}

	.setting-section {
		margin-bottom: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* Scrollbar styling */
	.settings-panel::-webkit-scrollbar {
		width: 8px;
	}

	.settings-panel::-webkit-scrollbar-track {
		background: rgba(255, 255, 255, 0.1);
		border-radius: 4px;
	}

	.settings-panel::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.3);
		border-radius: 4px;
	}

	.settings-panel::-webkit-scrollbar-thumb:hover {
		background: rgba(255, 255, 255, 0.4);
	}
</style>
