package net.ncplanner.plannerator.planner.localization;

/** Application-wide access point for the active user-interface language. */
public final class Localization{
    private static final TextLocalizer ACTIVE = new SimplifiedChineseLocalizer();
    private Localization(){}
    public static String localize(String text){
        return ACTIVE.localize(text);
    }
}
