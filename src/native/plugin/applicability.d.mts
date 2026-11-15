export function taskBinding(task: any, digest: (value: any) => string): any;
export function sameBinding(a: any, b: any): boolean;
export function mediaApplicable(
  image: any,
  task: any,
  artifacts: any[],
  digest: (value: any) => string,
): boolean;
export function acceptedReview(
  review: any,
  image: any,
  task: any,
  artifacts: any[],
  digest: (value: any) => string,
): boolean;
export function originalMediaContext(
  image: any,
  task: any,
  digest: (value: any) => string,
): boolean;
export function deliveryBindingCurrent(
  delivery: any,
  image: any,
  task: any,
  digest: (value: any) => string,
): boolean;
