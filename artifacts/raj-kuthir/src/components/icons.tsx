/**
 * The site's icons: Phosphor, light weight, two sizes.
 *
 * Icons are kept only where they do a job: call, WhatsApp, calendar, map,
 * chevrons, close, menu, download, copy, upload, share, status and the
 * busy spinner. Decoration is left to type and photographs.
 *
 * Sizes: "sm" (16px) sits inline with button and body text; "md" (20px) is
 * for icon-only controls. Every icon is hidden from screen readers; the
 * control around it carries the words (visible text or aria-label).
 */
import type { ComponentType } from 'react';
import {
  ArrowSquareOut,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  Copy,
  DownloadSimple,
  InstagramLogo,
  Leaf,
  List,
  LockSimple,
  MapPin,
  Phone,
  ShareNetwork,
  Star,
  UploadSimple,
  WarningCircle,
  WhatsappLogo,
  X,
  type IconProps as PhosphorProps,
  type IconWeight,
} from '@phosphor-icons/react';

export type IconSize = 'sm' | 'md';
const PX: Record<IconSize, number> = { sm: 16, md: 20 };

export type IconProps = { size?: IconSize; className?: string; weight?: IconWeight };

function make(Glyph: ComponentType<PhosphorProps>, name: string) {
  const Icon = ({ size = 'sm', className, weight = 'light' }: IconProps) => (
    <Glyph size={PX[size]} weight={weight} aria-hidden="true" focusable="false" className={!className ? 'shrink-0' : className.includes('shrink-0') ? className : `shrink-0 ${className}`} />
  );
  Icon.displayName = name;
  return Icon;
}

export const AlertIcon = make(WarningCircle, 'AlertIcon');
export const BackIcon = make(CaretLeft, 'BackIcon');
export const CalendarIcon = make(CalendarBlank, 'CalendarIcon');
export const CaretDownIcon = make(CaretDown, 'CaretDownIcon');
export const CaretLeftIcon = make(CaretLeft, 'CaretLeftIcon');
export const CaretRightIcon = make(CaretRight, 'CaretRightIcon');
export const CheckCircleIcon = make(CheckCircle, 'CheckCircleIcon');
export const CheckIcon = make(Check, 'CheckIcon');
export const ClockIcon = make(Clock, 'ClockIcon');
export const CloseIcon = make(X, 'CloseIcon');
export const CopyIcon = make(Copy, 'CopyIcon');
export const DownloadIcon = make(DownloadSimple, 'DownloadIcon');
export const ExternalIcon = make(ArrowSquareOut, 'ExternalIcon');
export const InstagramIcon = make(InstagramLogo, 'InstagramIcon');
/** The brand mark in the round badge beside the name. */
export const LeafIcon = make(Leaf, 'LeafIcon');
export const LockIcon = make(LockSimple, 'LockIcon');
export const MapPinIcon = make(MapPin, 'MapPinIcon');
export const MenuIcon = make(List, 'MenuIcon');
export const PhoneIcon = make(Phone, 'PhoneIcon');
export const ShareIcon = make(ShareNetwork, 'ShareIcon');
export const SpinnerIcon = make(CircleNotch, 'SpinnerIcon');
export const StarIcon = make(Star, 'StarIcon');
export const UploadIcon = make(UploadSimple, 'UploadIcon');
export const WhatsappIcon = make(WhatsappLogo, 'WhatsappIcon');
