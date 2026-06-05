<script lang="ts">
	import { Dialog } from 'bits-ui';

	interface Props {
		title: string;
		description: string;
		triggerLabel: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'default' | 'danger';
		onConfirm: () => void;
	}

	let {
		title,
		description,
		triggerLabel,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		variant = 'default',
		onConfirm
	}: Props = $props();

	let open = $state(false);

	function confirm() {
		onConfirm();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger
		class={variant === 'danger' ? 'carbon-btn-danger' : 'carbon-btn-secondary'}
	>
		{triggerLabel}
	</Dialog.Trigger>
	<Dialog.Portal>
		<Dialog.Overlay class="carbon-dialog-overlay" />
		<Dialog.Content class="carbon-dialog-content">
			<Dialog.Title class="text-base font-medium text-carbon-text">{title}</Dialog.Title>
			<Dialog.Description class="mt-2 text-sm text-carbon-text-secondary">
				{description}
			</Dialog.Description>
			<div class="mt-6 flex justify-end gap-2">
				<Dialog.Close class="carbon-btn-secondary">{cancelLabel}</Dialog.Close>
				<button
					type="button"
					class={variant === 'danger' ? 'carbon-btn-danger' : 'carbon-btn-primary'}
					data-testid="confirm-dialog-submit"
					onclick={confirm}
				>
					{confirmLabel}
				</button>
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
