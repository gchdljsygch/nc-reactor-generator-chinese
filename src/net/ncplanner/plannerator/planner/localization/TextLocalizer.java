package net.ncplanner.plannerator.planner.localization;

/** Translates user-facing text before it is measured or rendered. */
public interface TextLocalizer{
    String localize(String text);
}
