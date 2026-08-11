import { type ButtonHTMLAttributes, type MouseEvent as ReactMouseEvent, useCallback } from 'react';

import { useLightbox } from './context.ts';

export type LightboxCloseProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * renders a button that requests dismissal.
 *
 * @param props button properties; `onClick` runs before dismissal.
 * @returns the button.
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
	return <button {...rest} type={type ?? 'button'} data-lightbox-control="" onClick={handleClick} />;
};
