import { type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent, useCallback } from 'react';

import { useLightbox } from './context.ts';

export type LightboxCloseProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * a button that dismisses the lightbox (invokes the provider's `onDismiss`).
 * unlike a modal's own close, this carries no dialog semantics — it's a plain
 * button wired to the close action, usable inside any wrapper.
 *
 * @param props standard button props; `onClick` runs before the dismiss.
 */
export const Close = ({ onClick, type, ...rest }: LightboxCloseProps) => {
	const { close } = useLightbox();
	const handleClick = useCallback(
		(e: ReactMouseEvent<HTMLButtonElement>) => {
			onClick?.(e);
			if (!e.defaultPrevented) {
				close();
			}
		},
		[close, onClick],
	);
	return <button type={type ?? 'button'} data-lightbox-control="" onClick={handleClick} {...rest} />;
};
